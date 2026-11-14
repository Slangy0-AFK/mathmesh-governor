import { test, expect } from '@playwright/test';

/**
 * Live backend checks use the authenticated HTTP API directly. They mutate
 * dedicated test data, including a temporary global-stop change.
 */

const liveEnabled = process.env.E2E_RUN_LIVE === 'true';
const mutationConfirmed = process.env.E2E_ALLOW_MUTATIONS === 'true';
const liveConfig = {
  baseUrl: process.env.E2E_BASE_URL,
  email: process.env.E2E_AUTH_EMAIL,
  password: process.env.E2E_AUTH_PASSWORD,
};

if (liveEnabled) {
  const missing = [
    ['E2E_BASE_URL', liveConfig.baseUrl],
    ['E2E_AUTH_EMAIL', liveConfig.email],
    ['E2E_AUTH_PASSWORD', liveConfig.password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length || !mutationConfirmed) {
    throw new Error(
      `Live enforcement tests require ${[...missing, ...(!mutationConfirmed ? ['E2E_ALLOW_MUTATIONS=true'] : [])].join(', ')}.`,
    );
  }

  let target;
  try {
    target = new URL(liveConfig.baseUrl);
  } catch {
    throw new Error('E2E_BASE_URL must be an absolute HTTPS URL for a dedicated test deployment.');
  }
  if (target.protocol !== 'https:') {
    throw new Error('Live enforcement tests require an HTTPS test deployment.');
  }
}

const PROBE = 'E2EEnforcementProbe';
const RATE_PROBE = 'E2ERateProbe';
const BUDGET_PROBE = 'E2EBudgetProbe';
const KILL_PROBE = 'E2EKillProbe';
const PROBE_IDS = [PROBE, RATE_PROBE, BUDGET_PROBE, KILL_PROBE];
const UNKNOWN = () => `E2EUnknown_${Date.now()}`;

let api;

async function postJson(path, data) {
  const response = await api.post(path, { data });
  return { status: response.status(), body: await response.json() };
}

async function invoke(name, payload) {
  return (await postJson(`/api/functions/${name}`, payload)).body;
}

async function entityFilter(entity, criteria, limit = 100) {
  const { status, body } = await postJson(`/api/entities/${entity}/filter`, {
    criteria,
    sort: '-created_date',
    limit,
  });
  expect(status).toBe(200);
  return body;
}

async function entityCreate(entity, fields) {
  const { status, body } = await postJson(`/api/entities/${entity}/create`, fields);
  expect(status).toBe(201);
  return body;
}

async function entityUpdate(entity, id, patch) {
  const { status, body } = await postJson(`/api/entities/${entity}/update`, { id, patch });
  expect(status).toBe(200);
  return body;
}

async function entityDelete(entity, id) {
  const { status } = await postJson(`/api/entities/${entity}/delete`, { id });
  expect(status).toBe(200);
}

async function createAgent(agentId) {
  return entityCreate('AgentIdentity', {
    agent_id: agentId, role: 'reader', status: 'active', allowed_actions: [],
    session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
  });
}

async function cleanupTestData(ids) {
  for (const entity of ['AdmissionTicket', 'TokenSpend', 'AgentIdentity']) {
    const records = await entityFilter(entity, { agent_id: { $in: ids } }, 500);
    for (const record of records) await entityDelete(entity, record.id);
  }
}

test.describe('Live backend enforcement', () => {
  test.skip(!liveEnabled, 'Set E2E_RUN_LIVE=true and explicit test-deployment settings to run live tests.');

  test.beforeAll(async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: liveConfig.baseUrl });
    try {
      const login = await anonymous.post('/api/auth/login', {
        data: { email: liveConfig.email, password: liveConfig.password },
      });
      if (!login.ok()) throw new Error('Administrator login failed for live enforcement tests.');
      const session = await login.json();
      if (!session.access_token) throw new Error('Administrator login response did not contain a session token.');
      api = await playwright.request.newContext({
        baseURL: liveConfig.baseUrl,
        extraHTTPHeaders: { authorization: `Bearer ${session.access_token}` },
      });
      const currentUser = await api.get('/api/auth/me');
      if (!currentUser.ok() || (await currentUser.json()).role !== 'admin') {
        throw new Error('Live enforcement tests require an administrator account.');
      }
    } finally {
      await anonymous.dispose();
    }
  });

  test.afterAll(async () => {
    if (api) await api.dispose();
  });

  test.beforeEach(async () => {
    await cleanupTestData(PROBE_IDS);
  });

  test.afterEach(async () => {
    if (api) await cleanupTestData(PROBE_IDS);
  });

  test('unknown agent is refused at Identity, not auto-registered', async () => {
    const result = await invoke('admissionControl', {
      agentId: UNKNOWN(), action: 'Fetch_Database_Record', agentKey: 'x',
    });
    expect(result.admitted).toBe(false);
    expect(result.haltedAt).toBe('Identity');
  });

  test('valid key admits a read action; wrong key is denied at Identity', async () => {
    await createAgent(PROBE);
    const { key } = await invoke('issueAgentKey', { agentId: PROBE });

    const admitted = await invoke('admissionControl', {
      agentId: PROBE, action: 'Fetch_Database_Record', agentKey: key,
    });
    expect(admitted.admitted).toBe(true);

    const denied = await invoke('admissionControl', {
      agentId: PROBE, action: 'Fetch_Database_Record', agentKey: 'wrong',
    });
    expect(denied.admitted).toBe(false);
    expect(denied.haltedAt).toBe('Identity');
  });

  test('frozen and revoked agents are denied at Kill Switch', async () => {
    await createAgent(PROBE);
    const { key } = await invoke('issueAgentKey', { agentId: PROBE });
    let agent = (await entityFilter('AgentIdentity', { agent_id: PROBE }, 1))[0];

    await entityUpdate('AgentIdentity', agent.id, { status: 'frozen', revoked_reason: 'e2e' });
    const frozen = await invoke('admissionControl', {
      agentId: PROBE, action: 'Fetch_Database_Record', agentKey: key,
    });
    expect(frozen.admitted).toBe(false);
    expect(frozen.haltedAt).toBe('Kill Switch');

    agent = (await entityFilter('AgentIdentity', { agent_id: PROBE }, 1))[0];
    await entityUpdate('AgentIdentity', agent.id, { status: 'revoked', revoked_reason: 'e2e' });
    const revoked = await invoke('admissionControl', {
      agentId: PROBE, action: 'Fetch_Database_Record', agentKey: key,
    });
    expect(revoked.admitted).toBe(false);
    expect(revoked.haltedAt).toBe('Kill Switch');
  });

  test('reader disallowed action is denied at Tool Gate', async () => {
    await createAgent(PROBE);
    const { key } = await invoke('issueAgentKey', { agentId: PROBE });
    const result = await invoke('admissionControl', {
      agentId: PROBE, action: 'Call_API_Tool', agentKey: key,
    });
    expect(result.admitted).toBe(false);
    expect(result.haltedAt).toBe('Tool Gate');
  });

  test('rate limit denies excess requests in the configured window', async () => {
    await createAgent(RATE_PROBE);
    const { key } = await invoke('issueAgentKey', { agentId: RATE_PROBE });
    const actions = ['Fetch_Database_Record', 'Query_Web_Search'];
    let admitted = 0;
    let deniedAt = '';

    for (let index = 0; index < 22; index++) {
      const result = await invoke('admissionControl', {
        agentId: RATE_PROBE, action: actions[index % 2], agentKey: key,
      });
      if (result.admitted) admitted++;
      else {
        deniedAt = result.haltedAt;
        break;
      }
    }

    expect(deniedAt).toBe('Rate Limit');
    expect(admitted).toBeGreaterThanOrEqual(20);
  });

  test('token budget exhaustion denies admission before model spend', async () => {
    await createAgent(BUDGET_PROBE);
    const { key } = await invoke('issueAgentKey', { agentId: BUDGET_PROBE });
    const seed = await entityCreate('TokenSpend', {
      agent_id: BUDGET_PROBE, action: 'Fetch_Database_Record', session_nonce: '', phase: 'actual',
      purpose: 'generation', tokens_in: 45000, tokens_out: 0, tokens_total: 45000, estimated: true,
      note: 'E2E seed to trip the budget gate',
    });
    const result = await invoke('admissionControl', {
      agentId: BUDGET_PROBE, action: 'Fetch_Database_Record', agentKey: key,
    });
    await entityDelete('TokenSpend', seed.id);

    expect(result.admitted).toBe(false);
    expect(result.haltedAt).toBe('Token Budget');
  });

  test('global emergency stop denies at Kill Switch and is restored', async () => {
    await createAgent(KILL_PROBE);
    const { key } = await invoke('issueAgentKey', { agentId: KILL_PROBE });
    const controls = await entityFilter('HarnessControl', { singleton_key: 'GLOBAL' }, 1);
    const control = controls[0];
    if (!control) throw new Error('Global harness control record is missing.');
    const previous = {
      kill_all: control.kill_all,
      kill_all_reason: control.kill_all_reason || '',
      kill_all_engaged_by: control.kill_all_engaged_by || '',
    };

    let result;
    try {
      await entityUpdate('HarnessControl', control.id, {
        kill_all: true, kill_all_reason: 'E2E probe (momentary)', kill_all_engaged_by: 'e2e',
      });
      result = await invoke('admissionControl', {
        agentId: KILL_PROBE, action: 'Fetch_Database_Record', agentKey: key,
      });
    } finally {
      await entityUpdate('HarnessControl', control.id, previous);
    }

    expect(result.admitted).toBe(false);
    expect(result.haltedAt).toBe('Kill Switch');
  });

  test('an incorrect key denial does not create token-spend records', async () => {
    await createAgent(PROBE);
    await invoke('issueAgentKey', { agentId: PROBE });
    const result = await invoke('admissionControl', {
      agentId: PROBE, action: 'Fetch_Database_Record', agentKey: 'incorrect-key',
    });
    expect(result.admitted).toBe(false);
    expect(result.haltedAt).toBe('Identity');

    const spendRows = await entityFilter('TokenSpend', {
      agent_id: PROBE,
    }, 50);
    expect(spendRows).toHaveLength(0);
  });

  test('audit-chain verification returns a structured verdict', async () => {
    const result = await invoke('verifyAuditChain', { limit: 200 });
    expect(result).toHaveProperty('checked');
    expect(Array.isArray(result.problems)).toBe(true);
    expect(typeof result.ok).toBe('boolean');
  });

  test('egress proxy denies a non-allowlisted host', async () => {
    await createAgent(PROBE);
    const { key } = await invoke('issueAgentKey', { agentId: PROBE });
    const result = await invoke('egressProxy', {
      agentId: PROBE, action: 'Query_Web_Search', agentKey: key,
      url: 'https://e2e-nonexistent-probe.invalid/path',
    });
    expect(result.error).toBeTruthy();
    expect(['Egress', 'Kill Switch', 'Rate Limit', 'Token Budget', 'Identity', 'Tool Gate'])
      .toContain(result.haltedAt);
  });

  test('grounding review queue supports human review', async () => {
    const reviewer = await entityCreate('GroundingReview', {
      agent_id: PROBE, action: 'E2E_Review_Test', session_nonce: '', output_hash: 'e2e'.repeat(16),
      response_text: 'E2E probe response', context_provided: true, verdict: 'ungrounded',
      claims: [{ claim: 'probe claim', supported: false, citation: '', reason: 'e2e' }],
      unsupported_count: 1, total_claims: 1, blocked: true, status: 'pending',
      reviewed_by: '', review_note: '', checker_error: '',
    });
    try {
      await entityUpdate('GroundingReview', reviewer.id, { status: 'approved', reviewed_by: liveConfig.email });
      const updated = (await entityFilter('GroundingReview', { id: reviewer.id }, 1))[0];
      expect(updated.status).toBe('approved');
    } finally {
      await entityDelete('GroundingReview', reviewer.id);
    }
  });

  test('model-spend endpoint denies an unknown agent before any spend', async () => {
    const agentId = UNKNOWN();
    const { status, body } = await postJson('/api/functions/processWithSonnet', {
      agentId, agentKey: 'x', action: 'Write_Database_Record', payload: 'test request',
    });
    expect(status).toBe(403);
    expect(body.haltedAt).toBe('Identity');
    expect(body.serverEnforced).toBe(true);

    const spendRows = await entityFilter('TokenSpend', { agent_id: agentId }, 10);
    expect(spendRows).toHaveLength(0);
  });

  test('signed self-test report preserves probabilistic outcomes without gating on them', async () => {
    test.setTimeout(120_000);
    const report = await invoke('harnessSelfTest', {});

    expect(report.cases).toHaveLength(7);
    expect(report.summary).toMatchObject({ total: 7 });
    expect(report.summary.passed + report.summary.failed + report.summary.errored).toBe(7);
    expect(report.cases.every((entry) => [true, false, null].includes(entry.passed))).toBe(true);
    expect(report.reportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

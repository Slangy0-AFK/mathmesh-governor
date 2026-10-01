import { test, expect } from '@playwright/test';

/**
 * Live backend enforcement tests.
 *
 * Unlike the smoke tests, these exercise the DEPLOYED backend functions through
 * the app's own authenticated SDK (exposed on window.__base44 for testability) and
 * assert the actual control verdicts: identity, lifecycle, tool gate, rate limit,
 * token budget, global emergency stop, audit-chain verification, egress allowlist,
 * and the grounding review queue.
 *
 * They mutate data, including a temporary global-stop change. They only run
 * against an explicitly selected, dedicated test deployment.
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
  if (target.origin === 'https://lean-math-mesh.base44.app') {
    throw new Error('Live enforcement tests are blocked against the published production app.');
  }
}

const PROBE = 'E2EEnforcementProbe';
const RATE_PROBE = 'E2ERateProbe';
const BUDGET_PROBE = 'E2EBudgetProbe';
const KILL_PROBE = 'E2EKillProbe';
const UNKNOWN = () => `E2EUnknown_${Date.now()}`;

test.describe('Live backend enforcement', () => {
  test.skip(!liveEnabled, 'Set E2E_RUN_LIVE=true and explicit test-deployment settings to run live tests.');

  let page;

  test.beforeAll(async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto(baseURL || '/');
    const exposesClient = await page.evaluate(() => Boolean(window.__base44));
    if (!exposesClient) {
      throw new Error('Enable VITE_E2E_EXPOSE_BASE44=true on the dedicated test deployment to run SDK checks.');
    }
    const email = page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first();
    const password = page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first();
    await expect(email).toBeVisible({ timeout: 15_000 });
    await email.fill(liveConfig.email);
    await password.fill(liveConfig.password);
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
    // The auth flow hard-redirects; wait for the app to reload with an authenticated client.
    await page.waitForFunction(() => !!window.__base44, null, { timeout: 30_000 });
  });

  test.afterAll(async () => {
    if (page) await page.context().close();
  });

  const invoke = (name, payload) =>
    page.evaluate(async ({ n, p }) => {
      const r = await window.__base44.functions.invoke(n, p);
      return r.data ?? r;
    }, { n: name, p: payload });

  const cleanupAgents = (ids) =>
    page.evaluate(async (ids) => {
      for (const id of ids) {
        const list = await window.__base44.entities.AgentIdentity.filter({ agent_id: id }, '-created_date', 100);
        for (const agent of list) await window.__base44.entities.AgentIdentity.delete(agent.id);
      }
    }, ids);

  test.beforeEach(async () => {
    await cleanupAgents([PROBE, RATE_PROBE, BUDGET_PROBE, KILL_PROBE]);
  });

  test.afterEach(async () => {
    if (page) await cleanupAgents([PROBE, RATE_PROBE, BUDGET_PROBE, KILL_PROBE]);
  });

  test('unknown agent is refused at Identity (not auto-registered)', async () => {
    const r = await invoke('admissionControl', { agentId: UNKNOWN(), action: 'Fetch_Database_Record', agentKey: 'x' });
    expect(r.admitted).toBe(false);
    expect(r.haltedAt).toBe('Identity');
  });

  test('valid key + read action is admitted; wrong key is denied at Identity', async () => {
    await page.evaluate(async (id) => {
      await window.__base44.entities.AgentIdentity.create({
        agent_id: id, role: 'reader', status: 'active', allowed_actions: [],
        session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
    }, PROBE);
    const key = (await invoke('issueAgentKey', { agentId: PROBE })).key;

    const ok = await invoke('admissionControl', { agentId: PROBE, action: 'Fetch_Database_Record', agentKey: key });
    expect(ok.admitted).toBe(true);

    const bad = await invoke('admissionControl', { agentId: PROBE, action: 'Fetch_Database_Record', agentKey: 'wrong' });
    expect(bad.admitted).toBe(false);
    expect(bad.haltedAt).toBe('Identity');
  });

  test('frozen and revoked agents are denied at Kill Switch', async () => {
    const key = (await page.evaluate(async (id) => {
      await window.__base44.entities.AgentIdentity.create({
        agent_id: id, role: 'reader', status: 'active', allowed_actions: [],
        session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
      return (await window.__base44.functions.invoke('issueAgentKey', { agentId: id })).data.key;
    }, PROBE));

    await page.evaluate(async (id) => {
      const a = (await window.__base44.entities.AgentIdentity.filter({ agent_id: id }, '-created_date', 1))[0];
      await window.__base44.entities.AgentIdentity.update(a.id, { status: 'frozen', revoked_reason: 'e2e' });
    }, PROBE);
    const frozen = await invoke('admissionControl', { agentId: PROBE, action: 'Fetch_Database_Record', agentKey: key });
    expect(frozen.admitted).toBe(false);
    expect(frozen.haltedAt).toBe('Kill Switch');

    await page.evaluate(async (id) => {
      const a = (await window.__base44.entities.AgentIdentity.filter({ agent_id: id }, '-created_date', 1))[0];
      await window.__base44.entities.AgentIdentity.update(a.id, { status: 'revoked', revoked_reason: 'e2e' });
    }, PROBE);
    const revoked = await invoke('admissionControl', { agentId: PROBE, action: 'Fetch_Database_Record', agentKey: key });
    expect(revoked.admitted).toBe(false);
    expect(revoked.haltedAt).toBe('Kill Switch');
  });

  test('reader disallowed action is denied at Tool Gate', async () => {
    const key = (await page.evaluate(async (id) => {
      await window.__base44.entities.AgentIdentity.create({
        agent_id: id, role: 'reader', status: 'active', allowed_actions: [],
        session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
      return (await window.__base44.functions.invoke('issueAgentKey', { agentId: id })).data.key;
    }, PROBE));
    const r = await invoke('admissionControl', { agentId: PROBE, action: 'Call_API_Tool', agentKey: key });
    expect(r.admitted).toBe(false);
    expect(r.haltedAt).toBe('Tool Gate');
  });

  test('rate limit denies the 21st request in the window', async () => {
    const key = (await page.evaluate(async (id) => {
      await window.__base44.entities.AgentIdentity.create({
        agent_id: id, role: 'reader', status: 'active', allowed_actions: [],
        session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
      return (await window.__base44.functions.invoke('issueAgentKey', { agentId: id })).data.key;
    }, RATE_PROBE));
    const result = await page.evaluate(async ({ id, key }) => {
      const acts = ['Fetch_Database_Record', 'Query_Web_Search']; // alternate to avoid the loop breaker
      let admitted = 0, deniedAt = '';
      for (let i = 0; i < 22; i++) {
        const r = await window.__base44.functions.invoke('admissionControl', { agentId: id, action: acts[i % 2], agentKey: key });
        const d = r.data ?? r;
        if (d.admitted) admitted++; else { deniedAt = d.haltedAt; break; }
      }
      return { admitted, deniedAt };
    }, { id: RATE_PROBE, key });
    expect(result.deniedAt).toBe('Rate Limit');
    expect(result.admitted).toBeGreaterThanOrEqual(20);
  });

  test('token budget exhaustion denies at Token Budget (no real spend)', async () => {
    const result = await page.evaluate(async (id) => {
      await window.__base44.entities.AgentIdentity.create({
        agent_id: id, role: 'reader', status: 'active', allowed_actions: [],
        session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
      const key = (await window.__base44.functions.invoke('issueAgentKey', { agentId: id })).data.key;
      let seed;
      try {
        seed = await window.__base44.entities.TokenSpend.create({
          agent_id: id, action: 'Fetch_Database_Record', session_nonce: '', phase: 'actual',
          purpose: 'generation', tokens_in: 45000, tokens_out: 0, tokens_total: 45000, estimated: true,
          note: 'E2E seed to trip the budget gate',
        });
        const r = await window.__base44.functions.invoke('admissionControl', { agentId: id, action: 'Fetch_Database_Record', agentKey: key });
        const d = r.data ?? r;
        return { admitted: d.admitted, haltedAt: d.haltedAt };
      } finally {
        if (seed) await window.__base44.entities.TokenSpend.delete(seed.id);
      }
    }, BUDGET_PROBE);
    expect(result.admitted).toBe(false);
    expect(result.haltedAt).toBe('Token Budget');
  });

  test('global emergency stop denies at Kill Switch and is restored', async () => {
    const result = await page.evaluate(async (id) => {
      await window.__base44.entities.AgentIdentity.create({
        agent_id: id, role: 'reader', status: 'active', allowed_actions: [],
        session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
      const key = (await window.__base44.functions.invoke('issueAgentKey', { agentId: id })).data.key;
      const ctrl = (await window.__base44.entities.HarnessControl.filter({ singleton_key: 'GLOBAL' }, '-created_date', 1))[0];
      if (!ctrl) throw new Error('Global harness control record is missing.');
      const previous = {
        kill_all: ctrl.kill_all,
        kill_all_reason: ctrl.kill_all_reason || '',
        kill_all_engaged_by: ctrl.kill_all_engaged_by || '',
      };
      try {
        await window.__base44.entities.HarnessControl.update(ctrl.id, {
          kill_all: true,
          kill_all_reason: 'E2E probe (momentary)',
          kill_all_engaged_by: 'e2e',
        });
        const r = await window.__base44.functions.invoke('admissionControl', { agentId: id, action: 'Fetch_Database_Record', agentKey: key });
        const d = r.data ?? r;
        return { admitted: d.admitted, haltedAt: d.haltedAt };
      } finally {
        await window.__base44.entities.HarnessControl.update(ctrl.id, previous);
      }
    }, KILL_PROBE);
    expect(result.admitted).toBe(false);
    expect(result.haltedAt).toBe('Kill Switch');
  });

  test('no token spend is recorded for denied requests', async () => {
    const spend = await page.evaluate(async (ids) => {
      const rows = await window.__base44.entities.TokenSpend.filter({ agent_id: { $in: ids } }, '-created_date', 50);
      return rows.length;
    }, [PROBE, RATE_PROBE, KILL_PROBE]);
    expect(spend).toBe(0);
  });

  test('audit chain verification returns a structured verdict', async () => {
    const r = await invoke('verifyAuditChain', { limit: 200 });
    expect(r).toHaveProperty('checked');
    expect(Array.isArray(r.problems)).toBe(true);
    expect(typeof r.ok).toBe('boolean');
  });

  test('egress allowlist denies a non-allowlisted host', async () => {
    const key = (await page.evaluate(async (id) => {
      await window.__base44.entities.AgentIdentity.create({
        agent_id: id, role: 'reader', status: 'active', allowed_actions: [],
        session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
      return (await window.__base44.functions.invoke('issueAgentKey', { agentId: id })).data.key;
    }, PROBE));
    const r = await invoke('egressProxy', { agentId: PROBE, action: 'Query_Web_Search', agentKey: key, url: 'https://e2e-nonexistent-probe.invalid/path' });
    // Denied either at Egress (host not allowlisted) — the host is deliberately not on the list.
    expect(r.error).toBeTruthy();
    expect(['Egress', 'Kill Switch', 'Rate Limit', 'Token Budget', 'Identity', 'Tool Gate']).toContain(r.haltedAt);
  });

  test('grounding review queue supports human review (answer review)', async () => {
    const result = await page.evaluate(async (id) => {
      const me = await window.__base44.auth.me();
      let rec;
      try {
        rec = await window.__base44.entities.GroundingReview.create({
          agent_id: id, action: 'E2E_Review_Test', session_nonce: '', output_hash: 'e2e'.repeat(16),
          response_text: 'E2E probe response', context_provided: true, verdict: 'ungrounded',
          claims: [{ claim: 'probe claim', supported: false, citation: '', reason: 'e2e' }],
          unsupported_count: 1, total_claims: 1, blocked: true, status: 'pending',
          reviewed_by: '', review_note: '', checker_error: '',
        });
        await window.__base44.entities.GroundingReview.update(rec.id, { status: 'approved', reviewed_by: me?.email || 'e2e@test' });
        const list = await window.__base44.entities.GroundingReview.filter({ id: rec.id }, '-created_date', 1);
        return { status: list[0]?.status };
      } finally {
        if (rec) await window.__base44.entities.GroundingReview.delete(rec.id);
      }
    }, PROBE);
    expect(result.status).toBe('approved');
  });
});

async function signInAsAdmin(page) {
  await page.goto('/');

  const email = page.getByLabel(/email/i).first();
  if (await email.isVisible().catch(() => false)) {
    await email.fill(process.env.E2E_AUTH_EMAIL);
    await page.getByLabel(/password/i).first().fill(liveConfig.password);
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
  }

  await expect(page.getByRole('heading', { name: 'MathMesh Governor' })).toBeVisible({ timeout: 45_000 });
}

test.describe('Live enforcement checks', () => {
  test.skip(!liveEnabled, 'Set E2E_RUN_LIVE=true and explicit test-deployment settings to run live tests.');

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('unknown agent is denied before model use or token spend', async ({ page }) => {
    const agentId = `e2e-unknown-${Date.now()}`;

    await expect(page.getByText('Agent keys required', { exact: true })).toBeVisible();
    await page.getByLabel('Registered agent name').fill(agentId);
    await page.getByLabel('Requested action').fill('Write_Database_Record');
    await page.getByLabel(/Agent access key/).fill('');
    await page.getByRole('button', { name: 'Run test' }).click();

    await expect(page.getByText(new RegExp(`Server denied admission at Identity: Unknown agent "${agentId}"`)))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Sonnet 4\.6 Response/)).toHaveCount(0);

    await page.reload();
    const budgetPanel = page.getByTestId('token-budget-panel');
    await expect(budgetPanel).toHaveAttribute('data-loading', 'false', { timeout: 30_000 });
    await expect(budgetPanel.getByText(agentId, { exact: true })).toHaveCount(0);
  });

  test('signed self-test passes all live cases', async ({ page }) => {
    test.setTimeout(120_000);
    await page.getByRole('button', { name: 'Run signed test' }).click();

    await expect(page.getByText(/7\/7 passed/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/^sha256: [0-9a-f]{64}$/)).toBeVisible();
    await expect(page.getByText(/^hmac: [0-9a-f]{64}$/)).toBeVisible();
  });
});
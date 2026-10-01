import assert from 'node:assert/strict';
import { test } from 'node:test';
import { admitRequest, consumeTicket } from '../base44/shared/admission.ts';
import { sha256Hex } from '../base44/shared/agentKeys.ts';
import { escalateOnDrift } from '../base44/shared/enforcement.ts';
import { POLICY_DEFAULTS } from '../base44/shared/harnessPolicy.ts';

const VALID_KEY = 'mmk_test_key_for_unit_tests_only';
const VALID_KEY_HASH = await sha256Hex(VALID_KEY);

function matches(row, criteria) {
  return Object.entries(criteria || {}).every(([key, value]) => row[key] === value);
}

function createService({ policy = {}, agents = [], tickets = [], spends = [], audit = [] } = {}) {
  const tables = {
    HarnessControl: [{ id: 'policy-1', singleton_key: 'GLOBAL', ...POLICY_DEFAULTS, ...policy }],
    AgentIdentity: structuredClone(agents),
    AdmissionTicket: structuredClone(tickets),
    TokenSpend: structuredClone(spends),
    AuditLog: structuredClone(audit),
  };
  let nextId = 1;

  const entities = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, {
    filter: async (criteria = {}, sort = '', limit = Infinity) => {
      const result = rows.filter((row) => matches(row, criteria));
      if (sort) {
        const descending = sort.startsWith('-');
        const key = descending ? sort.slice(1) : sort;
        result.sort((a, b) => {
          if (a[key] === b[key]) return 0;
          const order = a[key] < b[key] ? -1 : 1;
          return descending ? -order : order;
        });
      }
      return result.slice(0, limit);
    },
    list: async (sort = '', limit = Infinity) => {
      const result = [...rows];
      if (sort) {
        const descending = sort.startsWith('-');
        const key = descending ? sort.slice(1) : sort;
        result.sort((a, b) => {
          if (a[key] === b[key]) return 0;
          const order = a[key] < b[key] ? -1 : 1;
          return descending ? -order : order;
        });
      }
      return result.slice(0, limit);
    },
    create: async (fields) => {
      const row = {
        id: `test-${nextId++}`,
        created_date: new Date().toISOString(),
        ...fields,
      };
      rows.push(row);
      return row;
    },
    update: async (id, fields) => {
      const row = rows.find((entry) => entry.id === id);
      if (!row) throw new Error(`Unknown ${name} row: ${id}`);
      Object.assign(row, fields);
      return row;
    },
  }]));

  return { entities, tables };
}

function agent(overrides = {}) {
  return {
    id: 'agent-row-1',
    agent_id: 'agent-test',
    role: 'reader',
    status: 'active',
    key_hash: VALID_KEY_HASH,
    allowed_actions: [],
    halt_count: 0,
    total_runs: 0,
    rate_limit_hits: 0,
    loop_trips: 0,
    drift_count: 0,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    agentId: 'agent-test',
    action: 'Fetch_Database_Record',
    agentKey: VALID_KEY,
    ...overrides,
  };
}

function oldTicket(overrides = {}) {
  return {
    id: 'ticket-old',
    ticket: 'ticket-old-value',
    agent_id: 'agent-test',
    action: 'Query_Web_Search',
    session_nonce: '',
    consumed: true,
    rejected: false,
    created_date: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}

test('unknown identities are refused without registration, tickets, or spend', async () => {
  const service = createService();
  const verdict = await admitRequest(service, request({ agentId: 'unknown-agent' }));

  assert.equal(verdict.admitted, false);
  assert.equal(verdict.haltedAt, 'Identity');
  assert.equal(service.tables.AgentIdentity.length, 0);
  assert.equal(service.tables.AdmissionTicket.length, 0);
  assert.equal(service.tables.TokenSpend.length, 0);
  assert.equal(service.tables.AuditLog.at(-1).event_type, 'IDENTITY_DENIED');
});

test('missing and incorrect keys are refused before admission', async (t) => {
  for (const [label, agentKey] of [['missing', ''], ['incorrect', 'wrong-key']]) {
    await t.test(label, async () => {
      const service = createService({ agents: [agent()] });
      const verdict = await admitRequest(service, request({ agentKey }));

      assert.equal(verdict.admitted, false);
      assert.equal(verdict.haltedAt, 'Identity');
      assert.equal(service.tables.AdmissionTicket.length, 0);
      assert.equal(service.tables.TokenSpend.length, 0);
      assert.equal(service.tables.AgentIdentity[0].key_auth_failures, 1);
    });
  }
});

test('frozen and revoked identities are denied with a valid key', async (t) => {
  for (const [status, enforcement] of [['frozen', 'freeze'], ['revoked', 'revoke']]) {
    await t.test(status, async () => {
      const service = createService({ agents: [agent({ status })] });
      const verdict = await admitRequest(service, request());

      assert.equal(verdict.admitted, false);
      assert.equal(verdict.haltedAt, 'Kill Switch');
      assert.equal(verdict.enforcement, enforcement);
      assert.equal(service.tables.AdmissionTicket.length, 0);
      assert.equal(service.tables.TokenSpend.length, 0);
    });
  }
});

test('role permissions deny actions outside the agent allowlist', async () => {
  const service = createService({ agents: [agent()] });
  const verdict = await admitRequest(service, request({ action: 'Write_Database_Record' }));

  assert.equal(verdict.admitted, false);
  assert.equal(verdict.haltedAt, 'Tool Gate');
  assert.equal(service.tables.AdmissionTicket.length, 0);
  assert.equal(service.tables.TokenSpend.length, 0);
});

test('global stop denies requests before looking up an identity', async () => {
  const service = createService({ policy: { kill_all: true, kill_all_reason: 'unit test' } });
  const verdict = await admitRequest(service, request({ agentId: 'unknown-agent' }));

  assert.equal(verdict.admitted, false);
  assert.equal(verdict.haltedAt, 'Kill Switch');
  assert.equal(service.tables.AgentIdentity.length, 0);
  assert.equal(service.tables.AdmissionTicket.length, 0);
  assert.equal(service.tables.TokenSpend.length, 0);
});

test('per-agent request limits deny excess admissions', async () => {
  const service = createService({
    policy: { max_runs_per_window: 1 },
    agents: [agent()],
    tickets: [oldTicket()],
  });
  const verdict = await admitRequest(service, request());

  assert.equal(verdict.admitted, false);
  assert.equal(verdict.haltedAt, 'Rate Limit');
  assert.equal(service.tables.TokenSpend.length, 0);
  assert.equal(service.tables.AdmissionTicket.filter((row) => row.rejected).length, 1);
});

test('consecutive repeated actions are denied by the loop limit', async () => {
  const service = createService({
    policy: { loop_repeat_limit: 1 },
    agents: [agent()],
    tickets: [oldTicket({ action: 'Fetch_Database_Record' })],
  });
  const verdict = await admitRequest(service, request());

  assert.equal(verdict.admitted, false);
  assert.equal(verdict.haltedAt, 'Base 60');
  assert.equal(service.tables.TokenSpend.length, 0);
  assert.equal(service.tables.AgentIdentity[0].loop_trips, 1);
});

test('exhausted estimated-token budgets deny admission before spend', async () => {
  const service = createService({
    policy: { max_tokens_per_window: 500, enforce_token_budget: true },
    agents: [agent()],
    spends: [{
      id: 'spend-existing', agent_id: 'agent-test', phase: 'actual', tokens_total: 500,
      created_date: new Date().toISOString(),
    }],
  });
  const verdict = await admitRequest(service, request());

  assert.equal(verdict.admitted, false);
  assert.equal(verdict.haltedAt, 'Token Budget');
  assert.equal(service.tables.TokenSpend.length, 1);
  assert.equal(service.tables.TokenSpend[0].id, 'spend-existing');
});

test('drift escalation freezes first and revokes at the configured strike', async (t) => {
  for (const [initialStrikes, expectedStatus, expectedEnforcement] of [
    [0, 'frozen', 'freeze'],
    [1, 'revoked', 'revoke'],
  ]) {
    await t.test(`${expectedStatus} at strike ${initialStrikes + 1}`, async () => {
      const testAgent = agent({ drift_count: initialStrikes });
      const service = createService({ agents: [testAgent] });
      const result = await escalateOnDrift(
        service,
        testAgent,
        { drift_strikes_before_revoke: 2, auto_revoke_on_drift: true },
        { score: 0.9, decoyId: 'test-decoy', nonce: `nonce-${initialStrikes}` },
      );

      assert.equal(result.enforcement, expectedEnforcement);
      assert.equal(service.tables.AgentIdentity[0].status, expectedStatus);
      assert.equal(service.tables.AgentIdentity[0].drift_count, initialStrikes + 1);
      assert.equal(service.tables.AuditLog.at(-1).event_type, expectedStatus === 'frozen' ? 'AGENT_FROZEN' : 'AGENT_REVOKED');
    });
  }
});

test('admission tickets are bound to an agent and action and can be consumed once', async () => {
  const service = createService({ agents: [agent()] });
  const verdict = await admitRequest(service, request());

  assert.equal(verdict.admitted, true);
  const wrongAgent = await consumeTicket(service, {
    ticket: verdict.ticket, agentId: 'different-agent', action: request().action,
    consumedBy: 'unit-test',
  });
  assert.equal(wrongAgent.ok, false);

  const wrongAction = await consumeTicket(service, {
    ticket: verdict.ticket, agentId: request().agentId, action: 'Write_Database_Record',
    consumedBy: 'unit-test',
  });
  assert.equal(wrongAction.ok, false);

  const consumed = await consumeTicket(service, {
    ticket: verdict.ticket, agentId: request().agentId, action: request().action,
    consumedBy: 'unit-test',
  });
  assert.equal(consumed.ok, true);

  const replayed = await consumeTicket(service, {
    ticket: verdict.ticket, agentId: request().agentId, action: request().action,
    consumedBy: 'unit-test',
  });
  assert.equal(replayed.ok, false);
  assert.match(replayed.reason, /already been spent/);
});
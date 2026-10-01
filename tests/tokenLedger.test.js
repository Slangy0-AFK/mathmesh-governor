import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chargeOverhead,
  estimateTokens,
  reconcileTokens,
  refundTokens,
  reserveTokens,
  windowSpend,
} from '../base44/shared/tokenLedger.ts';

function createService(spendRows = []) {
  const rows = [...spendRows];
  let nextId = rows.length + 1;

  return {
    rows,
    entities: {
      TokenSpend: {
        filter: async (criteria) => rows.filter((row) =>
          Object.entries(criteria).every(([key, value]) => row[key] === value)
        ),
        create: async (fields) => {
          const row = { id: `spend-${nextId++}`, created_date: new Date().toISOString(), ...fields };
          rows.push(row);
          return row;
        },
        update: async (id, fields) => {
          const row = rows.find((entry) => entry.id === id);
          if (!row) throw new Error(`Unknown token spend row: ${id}`);
          Object.assign(row, fields);
          return row;
        },
      },
    },
  };
}

function makePolicy(overrides = {}) {
  return {
    token_window_seconds: 3600,
    max_tokens_per_window: 10_000,
    max_tokens_per_request: 1000,
    enforce_token_budget: true,
    ...overrides,
  };
}

test('estimates tokens by rounding text length up in groups of four', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('reserves an estimated amount before a model call', async () => {
  const service = createService();
  const verdict = await reserveTokens(service, makePolicy(), {
    agentId: 'agent-a', action: 'Fetch_Database_Record', promptText: 'abcd',
  });

  assert.equal(verdict.allowed, true);
  assert.equal(verdict.requested, 257);
  assert.equal(service.rows.length, 1);
  assert.equal(service.rows[0].phase, 'reserved');
  assert.equal(service.rows[0].estimated, true);
});

test('does not reserve a request above the per-request limit', async () => {
  const service = createService();
  const verdict = await reserveTokens(service, makePolicy({ max_tokens_per_request: 500 }), {
    agentId: 'agent-a', action: 'Fetch_Database_Record', promptText: 'x'.repeat(1000),
  });

  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /per-request ceiling/);
  assert.equal(service.rows.length, 0);
});

test('does not reserve a request that would exceed the remaining window budget', async () => {
  const service = createService([{
    id: 'existing', agent_id: 'agent-a', created_date: new Date().toISOString(),
    phase: 'actual', tokens_total: 50,
  }]);
  const verdict = await reserveTokens(service, makePolicy({ max_tokens_per_window: 300 }), {
    agentId: 'agent-a', action: 'Fetch_Database_Record', promptText: 'abcd',
  });

  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /Token budget exhausted/);
  assert.equal(service.rows.length, 1);
});

test('ignores refunded and out-of-window spend', async () => {
  const service = createService([
    {
      id: 'refunded', agent_id: 'agent-a', created_date: new Date().toISOString(),
      phase: 'refunded', tokens_total: 500,
    },
    {
      id: 'expired', agent_id: 'agent-a', created_date: new Date(Date.now() - 7_200_000).toISOString(),
      phase: 'actual', tokens_total: 500,
    },
  ]);

  assert.equal(await windowSpend(service, 'agent-a', 3600), 0);
});

test('reconciles a reservation to the observed prompt and response lengths', async () => {
  const service = createService();
  const reservation = await reserveTokens(service, makePolicy(), {
    agentId: 'agent-a', action: 'Fetch_Database_Record', promptText: 'abcd',
  });
  const result = await reconcileTokens(service, reservation.reservationId, {
    promptText: 'abcd', responseText: '12345678',
  });

  assert.equal(result.tokens, 3);
  assert.equal(service.rows[0].phase, 'actual');
  assert.equal(service.rows[0].tokens_total, 3);
});

test('refunds an unused reservation so it no longer counts toward spend', async () => {
  const service = createService();
  const reservation = await reserveTokens(service, makePolicy(), {
    agentId: 'agent-a', action: 'Fetch_Database_Record', promptText: 'abcd',
  });
  await refundTokens(service, reservation.reservationId, 'Provider call did not start.');

  assert.equal(service.rows[0].phase, 'refunded');
  assert.equal(await windowSpend(service, 'agent-a', 3600), 0);
});

test('charges harness overhead to the same estimated spend ledger', async () => {
  const service = createService();
  const charged = await chargeOverhead(service, {
    agentId: 'agent-a', action: 'Fetch_Database_Record', purpose: 'judge',
    promptText: 'abcd', responseText: '1234',
  });

  assert.equal(charged, 2);
  assert.equal(service.rows[0].purpose, 'judge');
  assert.equal(service.rows[0].phase, 'actual');
  assert.equal(await windowSpend(service, 'agent-a', 3600), 2);
});
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { reserveTokens, windowSpend } from '../governor/shared/tokenLedger.ts';

test('PostgreSQL serializes reservations and counts the entire window', {
  skip: !process.env.TOKEN_LEDGER_TEST_DATABASE_URL && 'TOKEN_LEDGER_TEST_DATABASE_URL is not set',
}, async () => {
  process.env.DATABASE_URL = process.env.TOKEN_LEDGER_TEST_DATABASE_URL;
  const { initializeDatabase, pool, tokenLedger } = await import('../server/db.js');
  const agentId = `ledger-test-${randomUUID()}`;
  const svc = { tokenLedger };
  const policy = {
    token_window_seconds: 3600, max_tokens_per_window: 514,
    max_tokens_per_request: 1000, enforce_token_budget: true,
  };
  try {
    await initializeDatabase();
    const results = await Promise.all(Array.from({ length: 30 }, () =>
      reserveTokens(svc, policy, { agentId, action: 'test', promptText: 'abcd' })
    ));
    assert.equal(results.filter((result) => result.allowed).length, 2);
    assert.equal(await windowSpend(svc, agentId, 3600), 514);

    await pool.query(`
      INSERT INTO app_records (entity, data)
      SELECT 'TokenSpend', jsonb_build_object('agent_id', $1::text, 'phase', 'actual', 'tokens_total', 1)
      FROM generate_series(1, 501)
    `, [agentId]);
    assert.equal(await windowSpend(svc, agentId, 3600), 1015);
    const denied = await reserveTokens(svc, { ...policy, max_tokens_per_window: 1200 }, {
      agentId, action: 'test', promptText: 'abcd',
    });
    assert.equal(denied.allowed, false);

    await assert.rejects(tokenLedger.withReservationLock(agentId, async (ledger) => {
      await ledger.create({ agent_id: agentId, phase: 'reserved', tokens_total: 1 });
      throw new Error('test rollback');
    }), /test rollback/);
    assert.equal(await windowSpend(svc, agentId, 3600), 1015);

    await tokenLedger.withReservationLock(agentId, async (ledger) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await ledger.create({ agent_id: agentId, phase: 'reserved', tokens_total: 1 });
    });
    assert.equal(await windowSpend(svc, agentId, 1), 1);
  } finally {
    await pool.query("DELETE FROM app_records WHERE entity = 'TokenSpend' AND data->>'agent_id' = $1", [agentId]);
    await pool.end();
  }
});

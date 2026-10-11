import assert from 'node:assert/strict';
import { test } from 'node:test';
import health from '../base44/functions/health/entry.ts';

test('health endpoint reports liveness without exposing configuration', async () => {
  const response = health(new Request('https://example.test/api/health'));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('health endpoint rejects methods other than GET', async () => {
  const response = health(new Request('https://example.test/api/health', { method: 'POST' }));

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: 'Method not allowed' });
});
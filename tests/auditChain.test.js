import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendAudit, verifyChain } from '../base44/shared/auditChain.ts';

function createAuditService() {
  const rows = [];
  let nextId = 1;

  return {
    rows,
    entities: {
      AuditLog: {
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
          const row = { id: `audit-${nextId++}`, ...fields };
          rows.push(row);
          return row;
        },
      },
    },
  };
}

test('a correctly signed audit chain verifies', async () => {
  const service = createAuditService();
  await appendAudit(service, { event_type: 'TEST_EVENT', agent_id: 'agent-a', details: 'first' });
  await appendAudit(service, { event_type: 'TEST_EVENT', agent_id: 'agent-a', details: 'second' });

  const result = await verifyChain(service);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 2);
  assert.deepEqual(result.problems, []);
});

test('editing recorded facts is detected', async () => {
  const service = createAuditService();
  const row = await appendAudit(service, { event_type: 'TEST_EVENT', agent_id: 'agent-a', details: 'original' });
  row.details = 'changed';

  const result = await verifyChain(service);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.kind === 'altered'));
});

test('removing an event is detected as a broken link and sequence gap', async () => {
  const service = createAuditService();
  await appendAudit(service, { event_type: 'TEST_EVENT', agent_id: 'agent-a', details: 'first' });
  await appendAudit(service, { event_type: 'TEST_EVENT', agent_id: 'agent-a', details: 'second' });
  await appendAudit(service, { event_type: 'TEST_EVENT', agent_id: 'agent-a', details: 'third' });
  service.rows.splice(1, 1);

  const result = await verifyChain(service);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.kind === 'broken_link'));
  assert.ok(result.problems.some((problem) => problem.kind === 'gap'));
});
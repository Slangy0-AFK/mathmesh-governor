import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeOutput } from '../governor/shared/outputJudge.ts';
import { mapDecoyScores } from '../governor/shared/semanticDrift.ts';

test('missing decoy scores are an error rather than a zero-score pass', async () => {
  const result = await judgeOutput(
    'A response that does not engage with the decoy.',
    async () => ({ scores: [] }),
    { decoyIds: ['innocuous_metadata'] },
  );

  assert.equal(result.drift, false);
  assert.match(result.detectorError, /omitted a score/);
});

test('missing claim verdicts leave grounding unchecked', async () => {
  const result = await judgeOutput(
    'Revenue was 4.2 million euros.',
    async () => ({ scores: [] }),
    { context: 'Revenue was 4.2 million euros.' },
  );

  assert.equal(result.groundingVerdict, 'not_checked');
  assert.match(result.groundingError, /claims array/);
});

test('an empty claims array is not treated as a grounded answer', async () => {
  const result = await judgeOutput(
    'Revenue was 4.2 million euros.',
    async () => ({ scores: [], claims: [] }),
    { context: 'Revenue was 4.2 million euros.' },
  );

  assert.equal(result.groundingVerdict, 'not_checked');
  assert.match(result.groundingError, /no claim verdicts/);
});

test('a supported claim requires an exact quote from context', async () => {
  const result = await judgeOutput(
    'Revenue rose by 12%.',
    async () => ({
      scores: [],
      claims: [{ claim: 'Revenue rose by 12%.', supported: true, citation: 'Revenue rose by 12%.', reason: 'Supported.' }],
    }),
    { context: 'Revenue was 4.2 million euros.' },
  );

  assert.equal(result.groundingVerdict, 'ungrounded');
  assert.equal(result.unsupportedCount, 1);
});

test('valid exact citations remain grounded', async () => {
  const result = await judgeOutput(
    'Revenue was 4.2 million euros.',
    async () => ({
      scores: [],
      claims: [{ claim: 'Revenue was 4.2 million euros.', supported: true, citation: '4.2 million euros', reason: 'Supported.' }],
    }),
    { context: 'Revenue was 4.2 million euros.' },
  );

  assert.equal(result.groundingVerdict, 'grounded');
  assert.equal(result.unsupportedCount, 0);
});

test('malformed decoy scores are rejected instead of clamped', () => {
  assert.throws(
    () => mapDecoyScores([{ id: 'decoy-a', kind: 'test' }], [{ decoy_id: 'decoy-a', score: 2, reason: 'invalid' }]),
    /invalid score/,
  );
});
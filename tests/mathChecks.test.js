import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateBinaryRates, mean, roundRate, sampleStandardDeviation } from '../governor/shared/evaluationMetrics.ts';
import { evaluateVoteParity } from '../governor/shared/mathChecks.ts';

test('binary rates exclude failed judge attempts from their denominators', () => {
  const result = calculateBinaryRates([
    { expected: true, score: 0.9 },
    { expected: true, score: null },
    { expected: false, score: 0.2 },
    { expected: false, score: 0.8 },
    { expected: false, score: null },
  ], 0.5);

  assert.deepEqual(result, {
    true_positives: 1,
    false_positives: 1,
    true_negatives: 1,
    false_negatives: 0,
    evaluated: 3,
    errors: 2,
    tpr: 1,
    fpr: 0.5,
  });
});

test('undefined class rates remain null instead of looking like zero error', () => {
  const result = calculateBinaryRates([{ expected: true, score: null }], 0.5);
  assert.equal(result.tpr, null);
  assert.equal(result.fpr, null);
  assert.equal(result.errors, 1);
});

test('repeat summaries use sample standard deviation and ignore unavailable rates', () => {
  assert.equal(mean([0.25, 0.75]), 0.5);
  assert.equal(sampleStandardDeviation([0.25, 0.75]), Math.sqrt(0.125));
  assert.equal(mean([]), null);
  assert.equal(sampleStandardDeviation([0.5]), null);
  assert.equal(roundRate(null), null);
  assert.equal(roundRate(0.123456), 0.1235);
});

test('vote parity handles negative odd integers and rejects invalid votes', () => {
  assert.deepEqual(evaluateVoteParity([-3, 5, -7]), { aligned: true, reason: null });
  assert.equal(evaluateVoteParity([2, -3]).aligned, false);
  assert.equal(evaluateVoteParity([2, 2.5]).aligned, false);
});
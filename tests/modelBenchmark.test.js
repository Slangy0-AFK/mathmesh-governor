import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES, buildReport, scoreAnswer, VERSION } from '../base44/shared/modelBenchmark.js';

test('reference benchmark reports its version and fixed case count', () => {
  assert.equal(VERSION, 'mathmesh-reference-v3');
  assert.equal(CASES.length, 10);
});

test('scores only an exact typed answer in the required JSON shape', () => {
  const testCase = { expected: 391 };
  assert.deepEqual(scoreAnswer(testCase, '{"answer":391}'), {
    passed: true,
    reason: 'Exact typed reference match.',
  });
  assert.equal(scoreAnswer(testCase, '{"answer":"391"}').passed, false);
  assert.equal(scoreAnswer(testCase, '{"answer":391,"extra":true}').passed, false);
  assert.equal(scoreAnswer(testCase, 'not json').passed, false);
  assert.equal(scoreAnswer(testCase, '').passed, null);
});

test('report counts errors separately from failed and passed cases', () => {
  const report = buildReport('test-model', 'test-provider', [
    { passed: true, latencyMs: 10, usage: { total: 3 } },
    { passed: false, latencyMs: 20, usage: null },
    { passed: null, latencyMs: null, usage: null },
  ]);

  assert.deepEqual(report.summary, {
    total: 10,
    passed: 1,
    failed: 1,
    errored: 8,
    score: 1 / 10,
    meanLatencyMs: 15,
    measuredCases: 1,
    providerTokens: 3,
  });
});
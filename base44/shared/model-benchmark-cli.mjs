#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { CASES, buildReport, scoreAnswer } from './modelBenchmark.js';

const provider = (process.env.MODEL_PROVIDER || '').toLowerCase();
const model = process.env.MODEL_ID || '';
const apiKey = process.env.MODEL_API_KEY || '';
const endpoint = (process.env.MODEL_ENDPOINT || '').replace(/\/+$/, '');
if (!['openai', 'anthropic', 'gemini', 'compatible'].includes(provider) || !model || !apiKey) {
  console.error('Set MODEL_PROVIDER (openai|anthropic|gemini|compatible), MODEL_ID and MODEL_API_KEY. Compatible connections also require MODEL_ENDPOINT.');
  process.exit(2);
}
if (provider === 'compatible' && !endpoint.startsWith('https://')) {
  console.error('MODEL_ENDPOINT must be a trusted HTTPS OpenAI-compatible base URL.');
  process.exit(2);
}
async function call(prompt) {
  const headers = { 'Content-Type': 'application/json' }; let url, body;
  if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'; headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: 512, temperature: 0, messages: [{ role: 'user', content: prompt }] };
  } else if (provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`; headers['x-goog-api-key'] = apiKey;
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 512 } };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/responses'; headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: prompt, max_output_tokens: 512, store: false };
  } else {
    url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`; headers.Authorization = `Bearer ${apiKey}`;
    body = { model, max_tokens: 512, temperature: 0, messages: [{ role: 'user', content: prompt }] };
  }
  const start = Date.now();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const answer = provider === 'anthropic' ? data.content?.filter(p => p.type === 'text').map(p => p.text).join('') : provider === 'gemini' ? data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('') : provider === 'openai' ? data.output?.flatMap(p => p.content || []).filter(p => p.type === 'output_text').map(p => p.text).join('') : data.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('No text returned');
  const u = data.usage || data.usageMetadata;
  const input = u?.input_tokens ?? u?.prompt_tokens ?? u?.promptTokenCount;
  const output = u?.output_tokens ?? u?.completion_tokens ?? u?.candidatesTokenCount;
  const total = u?.total_tokens ?? u?.totalTokenCount ?? (Number.isFinite(input) && Number.isFinite(output) ? input + output : null);
  return { answer, latencyMs: Date.now() - start, usage: Number.isFinite(total) ? { input: input ?? null, output: output ?? null, total } : null };
}
console.log(`Running ${CASES.length} public reference cases against ${model} via ${provider}...`);
const cases = [];
for (const test of CASES) {
  try {
    const result = await call(test.prompt); const scored = scoreAnswer(test, result.answer);
    cases.push({ ...test, observed: result.answer, ...scored, latencyMs: result.latencyMs, usage: result.usage });
    console.log(`${scored.passed ? 'PASS' : 'FAIL'}  ${test.name} (${result.latencyMs} ms)`);
  } catch (error) {
    cases.push({ ...test, observed: '', passed: null, reason: `Provider error: ${error.message}`, latencyMs: null, usage: null });
    console.log(`ERROR ${test.name}: ${error.message}`);
  }
}
const report = buildReport(model, `${provider} — local GitHub runner`, cases);
await writeFile('mathmesh-benchmark-results.json', JSON.stringify(report, null, 2));
console.log(`\nScore: ${report.summary.passed}/${report.summary.total}; failures: ${report.summary.failed}; errors: ${report.summary.errored}`);
console.log('Full evidence: mathmesh-benchmark-results.json');
process.exitCode = report.summary.failed || report.summary.errored ? 1 : 0;
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { CASES, VERSION, scoreAnswer, buildReport } from '../../shared/modelBenchmark.ts';
import { prepareConnection, callConnectedModel } from '../../shared/modelConnection.ts';
import { loadPolicy } from '../../shared/harnessPolicy.ts';
import { reserveTokens } from '../../shared/tokenLedger.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Only an administrator can run model benchmarks or submit results.' }, { status: 403 });
    const raw = await req.text();
    if (raw.length > 40000) return Response.json({ error: 'Request exceeds 40,000 characters.' }, { status: 400 });
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Request must be JSON.' }, { status: 400 }); }
    if (body.mode === 'manifest') return Response.json({ version: VERSION, cases: CASES, scoring: 'Exact typed JSON answer; no extra keys or Markdown. Missing output is an error.' });
    if (body.version !== VERSION) return Response.json({ error: 'Benchmark version mismatch. Reload the task template.' }, { status: 400 });
    if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 150) return Response.json({ error: 'Model ID or submitted model label is required.' }, { status: 400 });
    if (body.mode === 'submitted') {
      if (!Array.isArray(body.answers) || body.answers.length > CASES.length || body.answers.some(a => !a || !CASES.some(c => c.id === a.id) || typeof a.answer !== 'string' || a.answer.length > 4000) || new Set(body.answers.map(a => a.id)).size !== body.answers.length) return Response.json({ error: 'Use up to six unique known case IDs, each with an answer string of at most 4,000 characters.' }, { status: 400 });
      const cases = CASES.map(test => {
        const observed = body.answers.find(a => a.id === test.id)?.answer || '';
        return { ...test, observed, ...scoreAnswer(test, observed), latencyMs: null, usage: null };
      });
      return Response.json(buildReport(body.model.trim(), 'submitted — unverified origin', cases));
    }
    if (body.mode !== 'live') return Response.json({ error: 'Use manifest, live or submitted mode.' }, { status: 400 });
    const svc = base44.asServiceRole;
    let connection;
    try { connection = await prepareConnection(svc, body); } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
    const policy = await loadPolicy(svc);
    if (policy.kill_all) return Response.json({ error: 'Global emergency stop is engaged.' }, { status: 403 });
    const budget = await reserveTokens(svc, policy, { agentId: `benchmark:${user.id}`, action: 'Model_Benchmark', sessionNonce: crypto.randomUUID(), purpose: 'eval', promptText: CASES.map(c => c.prompt).join('\n'), expectedOutputChars: CASES.length * 512 * 4 });
    if (!budget.allowed) return Response.json({ error: budget.reason }, { status: 429 });
    const cases = await Promise.all(CASES.map(async test => {
      try {
        const result = await callConnectedModel(connection, test.prompt);
        return { ...test, observed: result.answer, ...scoreAnswer(test, result.answer), latencyMs: result.latencyMs, usage: result.usage, modelReported: result.modelReported };
      } catch (error) {
        const reason = /HTTP \d{3}|No usable text|size limit/.test(error.message) ? error.message : 'Provider request failed or timed out; no score assigned.';
        return { ...test, observed: '', passed: null, reason, latencyMs: null, usage: null };
      }
    }));
    // Keep the reservation on unknown outcomes: an upstream timeout may still incur charges.
    if (budget.reservationId && cases.every(c => c.usage)) {
      await svc.entities.TokenSpend.update(budget.reservationId, { phase: 'actual', tokens_in: cases.reduce((n, c) => n + (c.usage.input || 0), 0), tokens_out: cases.reduce((n, c) => n + (c.usage.output || 0), 0), tokens_total: cases.reduce((n, c) => n + c.usage.total, 0), estimated: false, note: 'Provider-reported benchmark usage; not independently verified. Total may include reasoning tokens.' });
    }
    return Response.json({ ...buildReport(connection.model, connection.provider, cases), endpoint: connection.endpoint, budgetScope: 'Administrator benchmark allowance; not agent-pipeline enforcement.', keyStored: false });
  } catch (error) {
    return Response.json({ error: 'Benchmark could not complete. No successful result was inferred.' }, { status: 500 });
  }
}
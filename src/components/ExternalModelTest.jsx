import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import ModelConnectionForm from '@/components/benchmark/ModelConnectionForm';
import BenchmarkResults from '@/components/benchmark/BenchmarkResults';
export default function ExternalModelTest() {
  const [connection, setConnection] = useState({ provider: 'openai', model: '', endpoint: '', apiKey: '', answers: '' });
  const [manifest, setManifest] = useState(null);
  const [reports, setReports] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => { setError(''); try { const r = await base44.functions.invoke('testExternalModel', { mode: 'manifest' }); setManifest(r.data); } catch (e) { setError(e?.response?.data?.error || 'Could not load benchmark.'); } };
  useEffect(() => { load(); }, []);
  const run = async () => {
    setBusy(true); setError('');
    try {
      let request = { ...connection, mode: 'live', version: manifest.version };
      if (connection.provider === 'submitted') {
        const submission = JSON.parse(connection.answers);
        request = { mode: 'submitted', model: connection.model, version: submission.version, answers: submission.answers };
      }
      const r = await base44.functions.invoke('testExternalModel', request);
      setReports(previous => [...previous, r.data]);
    } catch (e) { setError(e?.response?.data?.error || e.message); }
    finally { setBusy(false); setConnection(current => ({ ...current, apiKey: '' })); }
  };
  const template = () => {
    const payload = { version: manifest.version, answers: manifest.cases.map(({ id, prompt }) => ({ id, prompt, answer: '' })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mathmesh-benchmark-tasks.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="space-y-4 text-foreground">
    <h2 className="text-sm font-semibold">Universal model connections & reference benchmarks</h2>
    <p className="text-xs text-muted-foreground">Connect OpenAI, Anthropic, Gemini or an OpenAI-compatible public service, or assess answers from any external agent. Protocol compatibility is required; this is not a promise to support every proprietary API. Admin only.</p>
    <ModelConnectionForm value={connection} onChange={setConnection} disabled={busy} />
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !manifest || !connection.model.trim() || (connection.provider !== 'submitted' && !connection.apiKey.trim())} onClick={run}>{busy ? 'Assessing six cases…' : connection.provider === 'submitted' ? 'Score submitted answers' : 'Run six-case benchmark'}</Button><Button variant="outline" disabled={!manifest || busy} onClick={template}>Download external task template</Button>{!manifest && <Button variant="outline" onClick={load}>Reload benchmark</Button>}</div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">{manifest?.version || 'Loading benchmark…'} · Exact reference answers, no keyword guessing or AI judge. Native providers may use different generation defaults; repeated runs can vary. Six public cases are a smoke test, not proof of general accuracy.</p>
    <p className="text-xs text-muted-foreground">These direct model benchmarks do not certify agent identity, permissions, rate limits or budgets. Live calls respect global stop and a separate per-operator estimated budget; that is not a hard provider billing cap. <a className="underline" href="#harness-assessment">Open the separate harness assessment</a> for grounding, drift, audit and signing checks. Full identity, permission and budget regression coverage is still pending.</p>
    <BenchmarkResults reports={reports} />
  </section>;
}
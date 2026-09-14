import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, FlaskConical, KeyRound, Loader2, X, AlertTriangle } from 'lucide-react';

const DEFAULT_ENDPOINTS = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' };

export default function ExternalModelTest() {
  const [provider, setProvider] = useState('openai');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINTS.openai);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const changeProvider = (value) => { setProvider(value); setEndpoint(DEFAULT_ENDPOINTS[value]); setReport(null); };
  const run = async () => {
    setBusy(true); setError(''); setReport(null);
    try {
      const response = await base44.functions.invoke('testExternalModel', { provider, endpoint, model, apiKey });
      setReport(response.data);
      setApiKey('');
    } catch (err) { setError(err?.response?.data?.error || err.message); }
    setBusy(false);
  };

  return <div>
    <div className="flex items-center gap-2 mb-1">
      <FlaskConical className="w-4 h-4 text-slate-500" />
      <p className="text-sm font-semibold text-slate-700">Bring Your Own Model</p>
    </div>
    <p className="text-xs text-slate-500 leading-relaxed mb-4">Run a five-case assessment against any OpenAI-compatible or Anthropic-compatible model. Your key is used for this run only and is not saved.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-1.5"><Label className="text-xs font-medium text-slate-600">Connection</Label><select value={provider} onChange={(event) => changeProvider(event.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic Messages API</option></select></div>
      <div className="space-y-1.5"><Label className="text-xs font-medium text-slate-600">Model id</Label><Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. gpt-4.1-mini or llama3.1" className="h-9 text-sm" /></div>
    </div>
    <div className="space-y-1.5 mt-3"><Label className="text-xs font-medium text-slate-600">Base endpoint</Label><Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://your-provider.example/v1" className="h-9 text-sm font-mono" /></div>
    <div className="space-y-1.5 mt-3"><Label className="text-xs font-medium text-slate-600">API key</Label><Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Used once, never stored" className="h-9 text-sm font-mono" /><p className="text-xs text-slate-400 flex items-center gap-1"><KeyRound className="w-3 h-3" />The key stays out of the report and browser history.</p></div>
    <Button onClick={run} disabled={busy || !model || !endpoint || !apiKey} className="mt-4 bg-slate-900 text-white">{busy ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Running 5 cases...</> : 'Run model assessment'}</Button>
    {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    {report && <div className="mt-4 space-y-2"><div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-xs font-semibold text-slate-700">{report.summary.passed}/{report.summary.total} passed · {report.model}</p><p className="text-xs text-slate-500 mt-0.5">Observed behavior only. The endpoint and provider identity are not independently verified.</p></div>{report.cases.map((item) => { const Icon = item.passed === true ? Check : item.passed === false ? X : AlertTriangle; const color = item.passed === true ? 'text-emerald-600' : item.passed === false ? 'text-red-500' : 'text-amber-600'; return <div key={item.id} className="rounded-lg border border-slate-100 px-3 py-2 flex gap-2"><Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${color}`} /><div><p className="text-xs font-medium text-slate-700">{item.name}</p><p className="text-xs text-slate-500 mt-0.5">{item.observed}</p></div></div>; })}</div>}
  </div>;
}
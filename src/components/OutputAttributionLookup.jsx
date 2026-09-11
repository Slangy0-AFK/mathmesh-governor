import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Fingerprint, Search, Loader2, BadgeCheck, ShieldAlert } from 'lucide-react';

export default function OutputAttributionLookup() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleLookup = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('verifyOutput', { text });
      setResult(res.data);
    } catch (err) {
      setResult({ error: err?.response?.data?.error || err.message });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Fingerprint className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Output Attribution &amp; Signature Verification</p>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        Two separate claims, kept separate. A <strong className="text-slate-600">match</strong> means the text hashes
        to a recorded output — anyone can compute that, so it only proves sameness. A{' '}
        <strong className="text-slate-600">valid signature</strong> means the record carries an HMAC produced with a
        secret held only on the server, which proves the text came from this harness, from that agent, in that
        session. The text must be byte-identical either way.
      </p>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste an output text to verify its origin..."
        className="text-sm resize-none h-24"
      />

      <Button onClick={handleLookup} disabled={busy || !text.trim()} variant="outline" className="w-full">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
        Verify this output
      </Button>

      {result?.error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{result.error}</p>
      )}

      {result?.outputHash && (
        <p className="text-xs font-mono text-slate-400 break-all">SHA-256: {result.outputHash}</p>
      )}

      {result && !result.error && (
        !result.matched ? (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
            No recorded output matches this text. Either it was not produced through this harness, or it has been
            altered since.
          </p>
        ) : (
          <div className="space-y-2">
            {result.results.map((m) => (
              <div
                key={m.runId}
                className={`text-xs rounded-lg px-3 py-2 space-y-0.5 border ${
                  m.verified ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                }`}
              >
                <p className={`font-semibold flex items-center gap-1.5 ${m.verified ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {m.verified ? <BadgeCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                  Produced by {m.agentId}
                </p>
                <p className={m.verified ? 'text-emerald-700' : 'text-amber-700'}>{m.verdict}</p>
                <p className={m.verified ? 'text-emerald-700' : 'text-amber-700'}>
                  Action: {m.action} · Status: {m.status}
                </p>
                <p className={`font-mono break-all ${m.verified ? 'text-emerald-600' : 'text-amber-600'}`}>
                  Session: {m.sessionNonce || 'none recorded'}
                </p>
                <p className={m.verified ? 'text-emerald-600' : 'text-amber-600'}>
                  {new Date(m.createdDate).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
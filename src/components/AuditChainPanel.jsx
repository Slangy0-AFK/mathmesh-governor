import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Link2, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';

const KIND_LABEL = {
  altered: 'Row edited after it was written',
  bad_signature: 'Signature does not verify — not written by this harness',
  broken_link: 'Chain link broken — a row was removed or reordered',
  gap: 'Sequence gap — event(s) deleted',
  fork: 'Two rows share a sequence (concurrent write, not tampering)',
  unsigned: 'Row has no signature',
  unchained: 'Row predates chaining — unverifiable either way',
};

export default function AuditChainPanel() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const verify = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await base44.functions.invoke('verifyAuditChain', { limit: 500 });
      setResult(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link2 className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Audit Chain Integrity</p>
        <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={verify} disabled={busy}>
          {busy ? 'Verifying…' : 'Verify chain'}
        </Button>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        Each audit event carries a sequence number, the previous event's hash, a hash of its own facts,
        and a server-only HMAC. Editing a row, deleting one, or forging a replacement all become
        detectable here. This is tamper-<span className="font-medium">evident</span>, not immutable —
        the table is still writable; the point is that damage cannot be silent.
      </p>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {result && (
        <div className={`rounded-lg px-3 py-2 mb-2 ${result.tamperingDetected ? 'bg-red-50' : 'bg-emerald-50'}`}>
          <div className="flex items-start gap-2">
            {result.tamperingDetected
              ? <ShieldAlert className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              : <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />}
            <div>
              <p className="text-xs font-medium text-slate-700">{result.summary}</p>
              <p className="text-xs text-slate-500 mt-0.5 font-mono break-all">head: {result.headHash?.slice(0, 32)}…</p>
            </div>
          </div>
        </div>
      )}

      {result?.problems?.length > 0 && (
        <div className="space-y-1">
          {result.problems.slice(0, 25).map((p, i) => (
            <div key={i} className={`rounded px-2 py-1.5 ${p.kind === 'unchained' || p.kind === 'fork' ? 'bg-amber-50' : 'bg-red-50'}`}>
              <div className="flex items-start gap-1.5">
                <AlertTriangle className={`w-3 h-3 mt-0.5 shrink-0 ${p.kind === 'unchained' || p.kind === 'fork' ? 'text-amber-600' : 'text-red-500'}`} />
                <div>
                  <p className="text-xs font-medium text-slate-700">seq {p.seq} — {KIND_LABEL[p.kind] || p.kind}</p>
                  <p className="text-xs text-slate-500">{p.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {result && <p className="text-xs text-slate-400 mt-2 leading-relaxed">{result.caveat}</p>}
    </div>
  );
}
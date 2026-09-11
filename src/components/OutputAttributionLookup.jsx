import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { sha256Hex } from '@/lib/outputAttribution';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Fingerprint, Search, Loader2 } from 'lucide-react';

export default function OutputAttributionLookup() {
  const [text, setText] = useState('');
  const [hash, setHash] = useState('');
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleLookup = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMatches(null);
    const digest = await sha256Hex(text);
    setHash(digest);
    try {
      const runs = await base44.entities.PipelineRun.filter({ output_hash: digest }, '-created_date', 10);
      setMatches(runs);
    } catch {
      setMatches([]);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Fingerprint className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Output Attribution</p>
      </div>

      <p className="text-xs text-slate-500 leading-relaxed">
        Every output this harness produced is hashed and bound to the agent and session that
        produced it. Paste a text to trace it back. The digest is unkeyed, so a match proves the
        text is identical to a recorded output — it is not a signature and not proof of authorship.
        The text must be byte-identical; a single edited character breaks the match.
      </p>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste an output text to trace its origin..."
        className="text-sm resize-none h-24"
      />

      <Button onClick={handleLookup} disabled={busy || !text.trim()} variant="outline" className="w-full">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
        Trace this output
      </Button>

      {hash && (
        <p className="text-xs font-mono text-slate-400 break-all">SHA-256: {hash}</p>
      )}

      {matches !== null && (
        matches.length === 0 ? (
          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
            No recorded output matches this text. Either it was not produced through this harness, or
            it has been altered since.
          </p>
        ) : (
          <div className="space-y-2">
            {matches.map((m) => (
              <div key={m.id} className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 space-y-0.5">
                <p className="font-semibold text-emerald-800">Produced by {m.agent_id}</p>
                <p className="text-emerald-700">Action: {m.action} · Status: {m.status}</p>
                <p className="font-mono text-emerald-600 break-all">Session: {m.session_nonce || 'none recorded'}</p>
                <p className="text-emerald-600">{new Date(m.created_date).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
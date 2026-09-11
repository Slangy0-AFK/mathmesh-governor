import { CheckCircle2, XCircle, ChevronDown, ChevronUp, Sparkles, BookOpen, AlertTriangle, Lock } from 'lucide-react';
import { useState } from 'react';

const statusConfig = {
  PASSED: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 border-emerald-100' },
  HALTED: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50 border-red-100' },
};

export default function RunLogEntry({ entry, index }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = statusConfig[entry.status] || statusConfig.HALTED;
  const Icon = cfg.icon;

  return (
    <div className={`rounded-xl border ${cfg.bg} transition-all duration-200`}>
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3"
        onClick={() => setExpanded(e => !e)}
      >
        <Icon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-slate-500">#{index + 1}</span>
            <span className="text-xs font-semibold text-slate-700">{entry.agentId}</span>
            <span className="text-xs text-slate-400">→</span>
            <span className="text-xs font-mono text-slate-600">{entry.action}</span>
            {entry.haltedAt && (
              <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">
                halted @ {entry.haltedAt}
              </span>
            )}
            {entry.estimatedTokensSaved > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium">
                ~{entry.estimatedTokensSaved} chars saved
              </span>
            )}
            {entry.cacheHit && (
              <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                CACHE HIT
              </span>
            )}
            {entry.driftDetected && (
              <span className="text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                DRIFT
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.message}</p>
        </div>
        <div className="shrink-0 text-slate-400">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5 border-t border-slate-100 pt-2 mt-0">
          {entry.steps.map((s) => (
            <div key={s.step} className="flex items-start gap-2 text-xs">
              <span className={`mt-0.5 font-bold shrink-0 ${s.passed ? 'text-emerald-500' : 'text-red-500'}`}>
                {s.passed ? '✓' : '✗'}
              </span>
              <span className="font-medium text-slate-700 shrink-0">{s.gate}:</span>
              <span className="text-slate-500">{s.detail}</span>
            </div>
          ))}
          <div className="text-xs text-slate-400 mt-1 font-mono">
            Payload: "{entry.rawPayload?.slice(0, 60)}{entry.rawPayload?.length > 60 ? '...' : ''}"
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Votes: [{entry.votes?.join(', ')}]
          </div>
          {entry.driftDetected && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-rose-600 mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" />
                TRIPWIRE DRIFT DETECTED
              </p>
              {entry.driftNonce && (
                <p className="text-xs font-mono text-rose-400 mb-1 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  nonce: {entry.driftNonce.slice(0, 32)}...
                </p>
              )}
              {entry.driftTerms?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.driftTerms.map((t, i) => (
                    <span key={i} className="text-xs bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {entry.ragContext && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-cyan-600 mb-1 flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                RAG Grounding Context {entry.ragSources?.length > 0 ? `(${entry.ragSources.length} sources)` : ''}
              </p>
              {entry.ragSources?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {entry.ragSources.map((s, i) => (
                    <span key={i} className="text-xs bg-cyan-50 text-cyan-600 px-1.5 py-0.5 rounded">
                      {s.title}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed bg-cyan-50/50 rounded p-2 border border-cyan-100 max-h-32 overflow-y-auto">
                {entry.ragContext}
              </p>
            </div>
          )}
          {entry.llmResponse && (
            <div className="mt-2 pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-indigo-600 mb-1 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                Sonnet 4.6 Response
              </p>
              <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded p-2 border border-slate-100 max-h-40 overflow-y-auto">
                {entry.llmResponse}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
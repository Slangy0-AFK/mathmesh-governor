import { CheckCircle, XCircle, Circle } from 'lucide-react';

const gateColors = {
  'Identity — Verify Agent': { pass: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200', badge: 'bg-slate-700 text-white' },
  'Tool Gate — Action Allowlist': { pass: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200', badge: 'bg-amber-600 text-white' },
  'Base 2 — Noise Stripper': { pass: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200', badge: 'bg-slate-800 text-white' },
  'Base 60 — Circuit Breaker': { pass: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200', badge: 'bg-amber-700 text-white' },
  'Base 8/10 — Matrix Voting': { pass: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200', badge: 'bg-blue-800 text-white' },
  'Base 12 — Semantic Dedup': { pass: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200', badge: 'bg-purple-800 text-white' },
  'Base 3 — Prompt Compression': { pass: 'bg-teal-50 border-teal-200', fail: 'bg-red-50 border-red-200', badge: 'bg-teal-700 text-white' },
  'Cache Check — Response Memoization': { pass: 'bg-amber-50 border-amber-200', fail: 'bg-red-50 border-red-200', badge: 'bg-amber-600 text-white' },
  'RAG — Context Retrieval': { pass: 'bg-cyan-50 border-cyan-200', fail: 'bg-red-50 border-red-200', badge: 'bg-cyan-700 text-white' },
  'Cache Store — Response Memoization': { pass: 'bg-amber-50 border-amber-200', fail: 'bg-red-50 border-red-200', badge: 'bg-amber-600 text-white' },
  'Tripwire — Drift Detection': { pass: 'bg-emerald-50 border-emerald-200', fail: 'bg-red-50 border-red-200', badge: 'bg-rose-900 text-white' },
  'Sonnet 4.6 — Safe Processing': { pass: 'bg-indigo-50 border-indigo-200', fail: 'bg-red-50 border-red-200', badge: 'bg-indigo-900 text-white' },
};

export default function PipelineStepCard({ step, gate, passed, detail, active }) {
  const colors = gateColors[gate] || { pass: 'bg-gray-50 border-gray-200', fail: 'bg-red-50 border-red-200', badge: 'bg-gray-700 text-white' };
  const stateClass = active ? (passed ? colors.pass : colors.fail) : 'bg-gray-50 border-gray-100 opacity-40';

  return (
    <div className={`rounded-xl border p-4 transition-all duration-300 ${stateClass}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {!active ? (
            <Circle className="w-5 h-5 text-gray-300" />
          ) : passed ? (
            <CheckCircle className="w-5 h-5 text-emerald-500" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge}`}>
              Step {step}
            </span>
            <span className="text-sm font-semibold text-slate-800">{gate}</span>
          </div>
          {active && (
            <p className={`mt-1.5 text-xs leading-relaxed ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {detail}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
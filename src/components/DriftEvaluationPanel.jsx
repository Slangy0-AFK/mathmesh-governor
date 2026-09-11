import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, Target, RefreshCw, AlertTriangle } from 'lucide-react';

export default function DriftEvaluationPanel() {
  const [latest, setLatest] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const rows = await base44.entities.DriftEvalResult.list('-created_date', 1);
      setLatest(rows[0] || null);
    } catch {
      setLatest(null);
    }
    setIsLoading(false);
  };

  const runEval = async () => {
    setIsRunning(true);
    setError('');
    try {
      await base44.functions.invoke('runDriftEval', {});
      await load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Evaluation failed.');
    }
    setIsRunning(false);
  };

  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Target className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Detector Evaluation — Measured TPR / FPR</p>
        <Button
          size="sm"
          variant="outline"
          onClick={runEval}
          disabled={isRunning}
          className="ml-auto text-slate-500 border-slate-200"
        >
          {isRunning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          {isRunning ? 'Running…' : 'Run Evaluation'}
        </Button>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        Runs the semantic detector against a hand-labeled set and reports true and false positive
        rates separately, alongside the old keyword detector on the identical set. Admin only — one
        model call per case.
      </p>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading last evaluation…
        </div>
      ) : !latest ? (
        <p className="text-sm text-slate-400 text-center py-6">
          Never evaluated. Until you run this, the detector has no measured accuracy — treat any
          claim about it as unverified.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="TPR (drift caught)" value={pct(latest.tpr)} tone="text-emerald-600" />
            <Metric label="FPR (false alarms)" value={pct(latest.fpr)} tone="text-red-500" />
            <Metric label="Threshold" value={String(latest.threshold)} tone="text-slate-700" />
            <Metric label="Labeled cases" value={String(latest.total_cases)} tone="text-slate-700" />
          </div>

          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-slate-600 mb-2">
              Old keyword detector, same set
            </p>
            <div className="flex gap-6 text-xs">
              <span className="text-slate-600">
                TPR <span className="font-bold text-slate-800">{pct(latest.keyword_baseline_tpr || 0)}</span>
              </span>
              <span className="text-slate-600">
                FPR <span className="font-bold text-red-600">{pct(latest.keyword_baseline_fpr || 0)}</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              A high keyword FPR is the point: substring matching flags on-task answers that merely
              use decoy vocabulary.
            </p>
          </div>

          {latest.threshold_sweep?.length > 1 &&
            new Set(latest.threshold_sweep.map((r) => `${r.tpr}|${r.fpr}`)).size === 1 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
              The sweep is flat — every threshold gives identical results. The judge is returning
              saturated scores (near 0 or near 1) rather than a spread, so the threshold is currently
              doing no work and "tuning" it would change nothing. Reducing the false-positive rate
              needs a better judge prompt or a genuinely graded score, not a different cutoff.
            </p>
          )}

          {latest.threshold_sweep?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">Threshold sweep</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 text-left">
                      <th className="py-1 pr-3 font-medium">Threshold</th>
                      <th className="py-1 pr-3 font-medium">TPR</th>
                      <th className="py-1 pr-3 font-medium">FPR</th>
                      <th className="py-1 pr-3 font-medium">Missed</th>
                      <th className="py-1 font-medium">False alarms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.threshold_sweep.map((r) => (
                      <tr
                        key={r.threshold}
                        className={r.threshold === latest.threshold ? 'bg-indigo-50 font-medium' : ''}
                      >
                        <td className="py-1 pr-3 font-mono">{r.threshold}</td>
                        <td className="py-1 pr-3">{pct(r.tpr)}</td>
                        <td className="py-1 pr-3">{pct(r.fpr)}</td>
                        <td className="py-1 pr-3">{r.false_negatives}</td>
                        <td className="py-1">{r.false_positives}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {latest.case_results?.some((c) => !c.correct) && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                Cases the detector got wrong
              </p>
              <div className="space-y-1.5">
                {latest.case_results.filter((c) => !c.correct).map((c) => (
                  <div key={c.case_id} className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <span className="font-mono text-slate-700">{c.case_id}</span>
                    <span className="text-slate-500">
                      {' '}— expected {c.expected_drift ? 'drift' : 'clean'}, scored {c.score?.toFixed(2)}
                    </span>
                    <p className="text-slate-500 mt-0.5">{c.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {latest.errors > 0 && (
            <p className="text-xs text-red-600">
              {latest.errors} case(s) the detector failed to score. Those are counted as
              not-detected, not silently dropped.
            </p>
          )}

          <p className="text-xs text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
            {latest.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="bg-slate-50 rounded-lg px-3 py-2.5">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}
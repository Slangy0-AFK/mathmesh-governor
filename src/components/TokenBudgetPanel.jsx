import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Gauge, RefreshCw } from 'lucide-react';

const PURPOSE_LABEL = {
  generation: 'Answers',
  judge: 'Harness — drift + grounding judge',
  dedup: 'Harness — dedup check',
  eval: 'Evaluation runs',
  other: 'Other',
};

export default function TokenBudgetPanel() {
  const [rows, setRows] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [spend, control] = await Promise.all([
      base44.entities.TokenSpend.list('-created_date', 300),
      base44.entities.HarnessControl.filter({ singleton_key: 'GLOBAL' }, '-created_date', 1),
    ]);
    setRows(spend.filter((r) => r.phase !== 'refunded'));
    setPolicy(control[0] || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const windowSeconds = policy?.token_window_seconds || 3600;
  const limit = policy?.max_tokens_per_window || 40000;
  const cutoff = Date.now() - windowSeconds * 1000;
  const inWindow = rows.filter((r) => new Date(r.created_date).getTime() >= cutoff);

  const byAgent = {};
  for (const r of inWindow) {
    if (!byAgent[r.agent_id]) byAgent[r.agent_id] = { total: 0, byPurpose: {} };
    byAgent[r.agent_id].total += r.tokens_total || 0;
    const p = r.purpose || 'other';
    byAgent[r.agent_id].byPurpose[p] = (byAgent[r.agent_id].byPurpose[p] || 0) + (r.tokens_total || 0);
  }

  const overhead = inWindow
    .filter((r) => r.purpose === 'judge' || r.purpose === 'dedup')
    .reduce((s, r) => s + (r.tokens_total || 0), 0);
  const total = inWindow.reduce((s, r) => s + (r.tokens_total || 0), 0);
  const overheadPct = total > 0 ? Math.round((overhead / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Gauge className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Token Budget</p>
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        Spend is bounded in estimated tokens per agent, not in requests — twenty long requests cost
        far more than twenty short ones, so a request cap never bounded exhaustion. Every number here
        is a chars/4 estimate, because the platform does not report provider usage.
        {policy?.enforce_token_budget === false && ' ENFORCEMENT IS OFF — spend is measured but never denied.'}
      </p>

      <div className="rounded-lg bg-slate-50 px-3 py-2 mb-3">
        <p className="text-xs text-slate-600">
          Harness overhead this window: <span className="font-semibold">{overhead.toLocaleString()}</span> of{' '}
          <span className="font-semibold">{total.toLocaleString()}</span> est. tokens ({overheadPct}%).
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          That is what the harness spends judging its own agents. It is charged to the same budget on
          purpose — a token-saving harness that hides its own consumption is only moving the cost.
        </p>
      </div>

      {Object.keys(byAgent).length === 0 ? (
        <p className="text-xs text-slate-400">No spend recorded in the last {Math.round(windowSeconds / 60)} minutes.</p>
      ) : (
        <div className="space-y-2">
          {Object.entries(byAgent)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([agentId, data]) => {
              const pct = Math.min(100, Math.round((data.total / limit) * 100));
              const hot = pct >= 80;
              return (
                <div key={agentId} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-slate-700 font-mono">{agentId}</p>
                    <p className={`text-xs font-semibold ${hot ? 'text-red-600' : 'text-slate-500'}`}>
                      ~{data.total.toLocaleString()} / {limit.toLocaleString()}
                    </p>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${hot ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    {Object.entries(data.byPurpose).map(([p, v]) => (
                      <span key={p} className="text-xs text-slate-500">
                        {PURPOSE_LABEL[p] || p}: ~{v.toLocaleString()}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
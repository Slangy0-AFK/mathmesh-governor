import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FileSearch, RefreshCw, Check, X, Quote } from 'lucide-react';

const VERDICT_STYLE = {
  grounded: 'bg-emerald-50 text-emerald-700',
  partly_grounded: 'bg-amber-50 text-amber-700',
  ungrounded: 'bg-red-50 text-red-700',
  not_checked: 'bg-slate-100 text-slate-600',
};

export default function GroundingReviewPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setItems(await base44.entities.GroundingReview.list('-created_date', 40));
      setError('');
    } catch (err) {
      setItems([]);
      setError('Grounding review data is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const review = async (id, status) => {
    const me = await base44.auth.me();
    await base44.entities.GroundingReview.update(id, { status, reviewed_by: me?.email || '' });
    load();
  };

  const pending = items.filter((i) => i.status === 'pending');

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <FileSearch className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Grounding Review Queue</p>
        <span className="ml-auto text-xs text-slate-400">{pending.length} pending</span>
        <Button size="sm" variant="ghost" className="h-7" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        Cite or admit: every factual claim must trace to a quote in the retrieved context. A claim that
        happens to be true but is uncited still counts as unsupported, because the harness cannot tell
        knowledge from invention. Failing answers are withheld from the caller and land here.
        The checker is itself a language model, so this queue is where a human is the actual authority.
      </p>

      {error && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3">{error}</p>}

      {items.length === 0 && <p className="text-xs text-slate-400">Nothing checked yet.</p>}

      <div className="space-y-2">
        {items.map((item) => {
          const open = openId === item.id;
          return (
            <div key={item.id} className="rounded-lg border border-slate-200">
              <button
                className="w-full text-left px-3 py-2 flex items-center gap-2"
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${VERDICT_STYLE[item.verdict] || VERDICT_STYLE.not_checked}`}>
                  {(item.verdict || 'not_checked').replace('_', ' ')}
                </span>
                <span className="text-xs font-mono text-slate-600">{item.agent_id}</span>
                <span className="text-xs text-slate-400 truncate">{item.action}</span>
                <span className="ml-auto text-xs text-slate-500 shrink-0">
                  {item.total_claims - item.unsupported_count}/{item.total_claims} cited
                  {item.blocked && <span className="text-red-600 font-medium"> · withheld</span>}
                  {item.status !== 'pending' && <span className="text-slate-400"> · {item.status}</span>}
                </span>
              </button>

              {open && (
                <div className="px-3 pb-3 border-t border-slate-100 pt-2">
                  {item.checker_error && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-2">
                      Checker did not run: {item.checker_error}
                    </p>
                  )}

                  <p className="text-xs font-medium text-slate-600 mb-1">Response</p>
                  <p className="text-xs text-slate-600 bg-slate-50 rounded p-2 mb-2 whitespace-pre-wrap">
                    {item.response_text}
                  </p>

                  <p className="text-xs font-medium text-slate-600 mb-1">Claims</p>
                  <div className="space-y-1 mb-2">
                    {(item.claims || []).length === 0 && (
                      <p className="text-xs text-slate-400">No factual claims were extracted.</p>
                    )}
                    {(item.claims || []).map((c, i) => (
                      <div key={i} className={`rounded px-2 py-1.5 ${c.supported ? 'bg-emerald-50' : 'bg-red-50'}`}>
                        <div className="flex items-start gap-1.5">
                          {c.supported
                            ? <Check className="w-3 h-3 text-emerald-600 mt-0.5 shrink-0" />
                            : <X className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />}
                          <div className="min-w-0">
                            <p className="text-xs text-slate-700">{c.claim}</p>
                            {c.citation && (
                              <p className="text-xs text-slate-500 mt-0.5 flex items-start gap-1">
                                <Quote className="w-2.5 h-2.5 mt-1 shrink-0" />
                                <span className="italic">{c.citation}</span>
                              </p>
                            )}
                            <p className="text-xs text-slate-400 mt-0.5">{c.reason}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {item.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" onClick={() => review(item.id, 'approved')}>
                        Approve as accurate
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => review(item.id, 'rejected')}>
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {item.status} by {item.reviewed_by || 'an operator'}.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
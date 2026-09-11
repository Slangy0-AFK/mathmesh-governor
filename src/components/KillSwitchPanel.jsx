import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Power, Loader2, ShieldAlert, Gauge } from 'lucide-react';

/**
 * Operator controls: the global emergency stop and the enforcement limits that
 * admission control reads on every request. Admin only, enforced server-side.
 */
export default function KillSwitchPanel({ onChange }) {
  const [policy, setPolicy] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ max_runs_per_window: 20, window_seconds: 60, loop_repeat_limit: 3, drift_strikes_before_revoke: 2 });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const rows = await base44.entities.HarnessControl.filter({ singleton_key: 'GLOBAL' }, '-created_date', 1);
      if (rows.length > 0) {
        setPolicy(rows[0]);
        setForm({
          max_runs_per_window: rows[0].max_runs_per_window ?? 20,
          window_seconds: rows[0].window_seconds ?? 60,
          loop_repeat_limit: rows[0].loop_repeat_limit ?? 3,
          drift_strikes_before_revoke: rows[0].drift_strikes_before_revoke ?? 2,
        });
      }
    } catch { /* not created until the first request */ }
  };

  const call = async (payload) => {
    setBusy(true);
    setError('');
    try {
      await base44.functions.invoke('killSwitch', payload);
      await load();
      onChange?.();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
    setBusy(false);
  };

  const engaged = !!policy?.kill_all;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Kill Switch &amp; Enforcement Policy</p>
        {engaged && (
          <span className="ml-auto text-xs font-bold bg-red-500 text-white px-2 py-0.5 rounded-full">ALL AGENTS STOPPED</span>
        )}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        These limits are read by admission control on every request, server-side, before any model
        spend. Changing them takes effect on the next request — no redeploy.
      </p>

      {/* Global stop */}
      <div className={`rounded-xl border p-4 mb-4 ${engaged ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-start gap-3">
          <Power className={`w-5 h-5 mt-0.5 shrink-0 ${engaged ? 'text-red-500' : 'text-slate-400'}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">Global Emergency Stop</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              {engaged
                ? `Engaged by ${policy.kill_all_engaged_by || 'an operator'}. Every agent is denied at admission. Reason: ${policy.kill_all_reason || 'none recorded'}`
                : 'Denies every agent request at admission, regardless of identity or role. Use when you do not yet know which agent is misbehaving.'}
            </p>
            {!engaged && (
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (recorded in the audit log)"
                className="text-sm h-8 mt-2"
              />
            )}
            <Button
              size="sm"
              variant={engaged ? 'outline' : 'destructive'}
              disabled={busy}
              onClick={() => call({ mode: engaged ? 'release_all' : 'engage_all', reason })}
              className="mt-2"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
              {engaged ? 'Release Global Stop' : 'Stop All Agents'}
            </Button>
          </div>
        </div>
      </div>

      {/* Limits */}
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="w-4 h-4 text-slate-400" />
          <p className="text-sm font-semibold text-slate-700">Limits</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'max_runs_per_window', label: 'Max requests per window', hint: 'Per agent identity' },
            { key: 'window_seconds', label: 'Window (seconds)', hint: 'Rate limit period' },
            { key: 'loop_repeat_limit', label: 'Repeat limit', hint: 'Identical actions in a row' },
            { key: 'drift_strikes_before_revoke', label: 'Drift strikes to revoke', hint: '1 = revoke on first trip' },
          ].map(({ key, label, hint }) => (
            <div key={key} className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">{label}</Label>
              <Input
                type="number"
                min="1"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: parseInt(e.target.value, 10) || 1 })}
                className="text-sm h-8"
              />
              <p className="text-xs text-slate-400">{hint}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
          <div className="min-w-0 pr-3">
            <p className="text-xs font-medium text-slate-600">Auto-revoke on drift</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              On when the tripwire should escalate to a hard revoke at the strike limit. Off means drift only ever freezes.
            </p>
          </div>
          <Switch
            checked={policy?.auto_revoke_on_drift !== false}
            disabled={busy}
            onCheckedChange={(v) => call({ mode: 'set_policy', auto_revoke_on_drift: v })}
          />
        </div>

        <Button size="sm" variant="outline" disabled={busy} onClick={() => call({ mode: 'set_policy', ...form })} className="mt-3">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save Limits
        </Button>
      </div>

      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
      <p className="text-xs text-slate-400 mt-3 leading-relaxed">
        Honest limit: this stops requests that go through this harness. It is not a process
        sandbox — an agent with its own network path is unaffected by anything here.
      </p>
    </div>
  );
}
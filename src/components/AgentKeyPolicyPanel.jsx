import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Switch } from '@/components/ui/switch';
import { Loader2, KeySquare, ShieldAlert } from 'lucide-react';

export default function AgentKeyPolicyPanel() {
  const [control, setControl] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const rows = await base44.entities.HarnessControl.filter({ singleton_key: 'GLOBAL' }, '-created_date', 1);
      setControl(rows[0] || null);
    } catch { /* fail silently */ }
  };

  const toggle = async (value) => {
    if (!control || busy) return;
    setBusy(true);
    try {
      await base44.entities.HarnessControl.update(control.id, { require_agent_key: value });
      await load();
    } catch { /* fail silently */ }
    setBusy(false);
  };

  const required = control ? control.require_agent_key !== false : true;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <KeySquare className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Identity Authentication</p>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ml-auto" />}
      </div>

      <div className={`rounded-xl border px-4 py-3 flex items-start justify-between gap-4 ${required ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className="space-y-1">
          <p className={`text-sm font-semibold ${required ? 'text-emerald-800' : 'text-amber-800'}`}>
            {required ? 'Agent keys required' : 'Agent keys NOT required'}
          </p>
          <p className={`text-xs leading-relaxed ${required ? 'text-emerald-700' : 'text-amber-700'}`}>
            {required
              ? 'Every request must present the secret key for the identity it claims, and unknown agent ids are refused rather than auto-registered. A frozen agent cannot escape by renaming itself.'
              : 'Identity is a claimed string again. The tool gate, rate limit and kill switch still run, but they only govern an agent that chooses to identify itself honestly.'}
          </p>
        </div>
        <Switch checked={required} onCheckedChange={toggle} disabled={!control || busy} />
      </div>

      {!required && (
        <p className="text-xs text-amber-600 flex items-start gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          This is the weaker, older behaviour. It is offered because it is useful while testing — not because it is safe.
        </p>
      )}
    </div>
  );
}
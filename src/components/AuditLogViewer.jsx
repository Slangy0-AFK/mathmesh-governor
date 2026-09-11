import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, AlertTriangle, CheckCircle, Loader2, Fingerprint, RefreshCw, Ban, Snowflake, Database, Lock } from 'lucide-react';

const eventConfig = {
  IDENTITY_VERIFIED: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Identity Verified' },
  IDENTITY_DENIED: { icon: Ban, color: 'text-red-600', bg: 'bg-red-50', label: 'Identity Denied' },
  TOOL_GATE_PASS: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Tool Gate Pass' },
  TOOL_GATE_DENIED: { icon: Ban, color: 'text-red-600', bg: 'bg-red-50', label: 'Tool Gate Denied' },
  GATE_PASS: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Gate Pass' },
  GATE_HALT: { icon: Ban, color: 'text-red-600', bg: 'bg-red-50', label: 'Gate Halt' },
  CACHE_HIT: { icon: Database, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Cache Hit' },
  CACHE_STORE: { icon: Database, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Cache Store' },
  DRIFT_DETECTED: { icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50', label: 'Drift Detected' },
  TRIPWIRE_PASS: { icon: Shield, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Tripwire Pass' },
  AGENT_REVOKED: { icon: Ban, color: 'text-red-600', bg: 'bg-red-50', label: 'Agent Revoked' },
  AGENT_FROZEN: { icon: Snowflake, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Agent Frozen' },
  PIPELINE_COMPLETE: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Pipeline Complete' },
};

export default function AuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { loadLogs(); }, []);

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      const result = await base44.entities.AuditLog.list('-created_date', 50);
      setLogs(result);
    } catch (err) { /* fail silently */ }
    setIsLoading(false);
  };

  const driftCount = logs.filter(l => l.drift_signal).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Fingerprint className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Audit Log</p>
        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
          {logs.length} events
        </span>
        {driftCount > 0 && (
          <span className="text-xs bg-rose-100 text-rose-600 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {driftCount} drift{driftCount !== 1 ? 's' : ''}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={loadLogs} className="ml-auto h-7 text-xs text-slate-400">
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading audit log...
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">No audit events yet. Run the pipeline to generate events.</p>
      ) : (
        <ScrollArea className="h-80 rounded-lg border border-slate-100">
          <div className="p-3 space-y-1.5">
            {logs.map((log) => {
              const cfg = eventConfig[log.event_type] || { icon: Shield, color: 'text-slate-500', bg: 'bg-slate-50', label: log.event_type };
              const Icon = cfg.icon;
              return (
                <div key={log.id} className={`rounded-lg ${cfg.bg} px-3 py-2 flex items-start gap-2.5`}>
                  <Icon className={`w-4 h-4 ${cfg.color} shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
                      <span className="text-xs font-mono text-slate-500">{log.agent_id}</span>
                      {log.gate && (
                        <span className="text-xs text-slate-400">· {log.gate}</span>
                      )}
                      {log.action && (
                        <span className="text-xs font-mono text-slate-400">· {log.action}</span>
                      )}
                    </div>
                    {log.details && (
                      <p className="text-xs text-slate-500 mt-0.5">{log.details}</p>
                    )}
                    {log.event_nonce && (
                      <p className="text-xs font-mono text-rose-400 mt-0.5 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        nonce: {log.event_nonce.slice(0, 32)}...
                      </p>
                    )}
                  </div>
                  {log.drift_signal && (
                    <Badge variant="outline" className="text-xs border-rose-300 text-rose-500 shrink-0">
                      DRIFT
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
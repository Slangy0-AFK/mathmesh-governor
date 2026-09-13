import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { UserCog, Skull, Snowflake, Activity, Loader2, Plus, RefreshCw, KeyRound, KeySquare, Copy } from 'lucide-react';

const statusConfig = {
  active: { icon: Activity, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', label: 'Active' },
  frozen: { icon: Snowflake, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', label: 'Frozen' },
  revoked: { icon: Skull, color: 'text-red-600', bg: 'bg-red-50 border-red-200', label: 'Revoked' },
};

const roleColors = {
  admin: 'bg-slate-800 text-white',
  reader: 'bg-blue-100 text-blue-700',
  writer: 'bg-teal-100 text-teal-700',
  tool_caller: 'bg-amber-100 text-amber-700',
};

export default function AgentIdentityManager({ onKeyIssued }) {
  const [agents, setAgents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newAgentId, setNewAgentId] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('reader');
  // Holds a freshly issued key for exactly as long as the operator needs to copy it.
  // It is never persisted here, because the server does not store it either.
  const [issued, setIssued] = useState(null);
  const [issuing, setIssuing] = useState('');

  useEffect(() => { loadAgents(); }, []);

  const loadAgents = async () => {
    setIsLoading(true);
    try {
      const result = await base44.entities.AgentIdentity.list('-created_date', 50);
      setAgents(result);
    } catch (err) { /* fail silently */ }
    setIsLoading(false);
  };

  const handleRegister = async () => {
    if (!newAgentId.trim()) return;
    try {
      await base44.entities.AgentIdentity.create({
        agent_id: newAgentId.trim(), role: newAgentRole, status: 'active',
        allowed_actions: [], session_nonce: '', total_runs: 0, halt_count: 0, drift_count: 0,
      });
      setNewAgentId('');
      loadAgents();
    } catch (err) { /* fail silently */ }
  };

  const handleIssueKey = async (agent) => {
    setIssuing(agent.agent_id);
    setIssued(null);
    try {
      const res = await base44.functions.invoke('issueAgentKey', { agentId: agent.agent_id });
      setIssued(res.data);
      onKeyIssued?.(res.data.agentId, res.data.key);
      loadAgents();
    } catch (err) {
      setIssued({ error: err?.response?.data?.error || err.message });
    }
    setIssuing('');
  };

  const handleRoleChange = async (agent, newRole) => {
    try {
      await base44.entities.AgentIdentity.update(agent.id, { role: newRole });
      loadAgents();
    } catch (err) { /* fail silently */ }
  };

  const handleKillSwitch = async (agent) => {
    try {
      await base44.entities.AgentIdentity.update(agent.id, {
        status: 'revoked', revoked_reason: 'Manual kill switch activation',
      });
      loadAgents();
    } catch (err) { /* fail silently */ }
  };

  const handleUnfreeze = async (agent) => {
    try {
      await base44.entities.AgentIdentity.update(agent.id, {
        status: 'active', revoked_reason: '',
      });
      loadAgents();
    } catch (err) { /* fail silently */ }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Agent Identity Registry</p>
        <Button variant="ghost" size="sm" onClick={loadAgents} className="ml-auto h-7 text-xs text-slate-400">
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Register new agent */}
      <div className="flex gap-2 mb-4 pb-4 border-b border-slate-100">
        <Input
          value={newAgentId}
          onChange={e => setNewAgentId(e.target.value)}
          placeholder="New agent ID (e.g. Scanner_3)"
          className="text-sm h-9 flex-1"
        />
        <select
          value={newAgentRole}
          onChange={e => setNewAgentRole(e.target.value)}
          className="text-sm h-9 rounded-md border border-slate-200 bg-white px-3 text-slate-700"
        >
          <option value="reader">Reader</option>
          <option value="writer">Writer</option>
          <option value="tool_caller">Tool Caller</option>
          <option value="admin">Admin</option>
        </select>
        <Button size="sm" onClick={handleRegister} className="h-9 bg-slate-900 hover:bg-slate-700 text-white">
          <Plus className="w-3.5 h-3.5 mr-1" />
          Register
        </Button>
      </div>

      {/* One-time key reveal */}
      {issued && (
        <div className={`rounded-xl border px-4 py-3 mb-4 ${issued.error ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          {issued.error ? (
            <p className="text-sm text-red-700">{issued.error}</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-amber-800">
                {issued.rotation ? 'Key rotated' : 'Key issued'} for {issued.agentId}
              </p>
              <p className="text-xs text-amber-700 mt-0.5 mb-2">{issued.warning} Any previous key stopped working.</p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono bg-white border border-amber-200 rounded-md px-2 py-1.5 flex-1 break-all text-slate-800">
                  {issued.key}
                </code>
                <Button
                  variant="outline" size="sm"
                  onClick={() => navigator.clipboard?.writeText(issued.key)}
                  className="h-8 text-xs border-amber-300 text-amber-700"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIssued(null)} className="h-8 text-xs text-amber-600">
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Agent list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading agents...
        </div>
      ) : agents.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">No agents registered yet. Run the pipeline to auto-register, or register one above.</p>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => {
            const cfg = statusConfig[agent.status] || statusConfig.active;
            const StatusIcon = cfg.icon;
            return (
              <div key={agent.id} className={`rounded-xl border ${cfg.bg} px-4 py-3`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono font-semibold text-slate-700">{agent.agent_id}</span>
                    <Badge className={`${roleColors[agent.role] || 'bg-gray-100 text-gray-700'} text-xs`}>
                      {agent.role}
                    </Badge>
                    <span className={`text-xs font-medium flex items-center gap-1 ${cfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                    {agent.key_hash ? (
                      <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                        <KeySquare className="w-3 h-3" />
                        keyed ···{agent.key_last_four}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-amber-600 flex items-center gap-1">
                        <KeySquare className="w-3 h-3" />
                        no key
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Stats */}
                    <div className="flex gap-3 text-xs text-slate-400">
                      <span>{agent.total_runs || 0} runs</span>
                      <span>{agent.halt_count || 0} halts</span>
                      <span className={agent.drift_count > 0 ? 'text-rose-500 font-semibold' : ''}>
                        {agent.drift_count || 0} drifts
                      </span>
                    </div>
                    {/* Actions */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleIssueKey(agent)}
                      disabled={issuing === agent.agent_id}
                      className="h-7 text-xs border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      {issuing === agent.agent_id
                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        : <KeySquare className="w-3 h-3 mr-1" />}
                      {agent.key_hash ? 'Rotate key' : 'Issue key'}
                    </Button>
                    {agent.status !== 'revoked' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleKillSwitch(agent)}
                        className="h-7 text-xs border-red-200 text-red-500 hover:bg-red-50"
                      >
                        <Skull className="w-3 h-3 mr-1" />
                        Kill
                      </Button>
                    )}
                    {agent.status === 'frozen' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleUnfreeze(agent)}
                        className="h-7 text-xs border-blue-200 text-blue-500 hover:bg-blue-50"
                      >
                        <Activity className="w-3 h-3 mr-1" />
                        Unfreeze
                      </Button>
                    )}
                  </div>
                </div>
                {/* Role selector */}
                {agent.status !== 'revoked' && (
                  <div className="mt-2 flex items-center gap-2">
                    <UserCog className="w-3 h-3 text-slate-400" />
                    <select
                      value={agent.role}
                      onChange={e => handleRoleChange(agent, e.target.value)}
                      className="text-xs h-7 rounded-md border border-slate-200 bg-white px-2 text-slate-600"
                    >
                      <option value="reader">Reader</option>
                      <option value="writer">Writer</option>
                      <option value="tool_caller">Tool Caller</option>
                      <option value="admin">Admin</option>
                    </select>
                    {agent.last_drift_nonce && (
                      <span className="text-xs font-mono text-rose-400 ml-auto">
                        Last drift nonce: {agent.last_drift_nonce.slice(0, 16)}...
                      </span>
                    )}
                  </div>
                )}
                {agent.revoked_reason && (
                  <p className="text-xs text-slate-400 mt-1 italic">{agent.revoked_reason}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
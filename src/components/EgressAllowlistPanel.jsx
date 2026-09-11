import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Globe, Plus, Trash2, Loader2, RefreshCw, Info } from 'lucide-react';

const METHODS = ['GET', 'POST'];

export default function EgressAllowlistPanel() {
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newHost, setNewHost] = useState('');
  const [newNote, setNewNote] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      setHosts(await base44.entities.EgressAllowlist.list('-created_date', 50));
    } catch { /* fail silently */ }
    setLoading(false);
  };

  const add = async () => {
    const host = newHost.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) return;
    try {
      await base44.entities.EgressAllowlist.create({
        host, note: newNote.trim(), allowed_methods: ['GET'], enabled: true, request_count: 0,
      });
      setNewHost(''); setNewNote('');
      load();
    } catch { /* fail silently */ }
  };

  const toggleMethod = async (entry, method) => {
    const current = Array.isArray(entry.allowed_methods) ? entry.allowed_methods : ['GET'];
    const next = current.includes(method) ? current.filter((m) => m !== method) : [...current, method];
    await base44.entities.EgressAllowlist.update(entry.id, { allowed_methods: next });
    load();
  };

  const toggleEnabled = async (entry, value) => {
    await base44.entities.EgressAllowlist.update(entry.id, { enabled: value });
    load();
  };

  const remove = async (entry) => {
    await base44.entities.EgressAllowlist.delete(entry.id);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Egress Allowlist</p>
        <Button variant="ghost" size="sm" onClick={load} className="ml-auto h-7 text-xs text-slate-400">
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 flex gap-2">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
        <span>
          Outbound calls routed through the harness proxy are denied by default and permitted
          only to the exact hosts listed here, over https, using the methods you tick. Every
          attempt is logged against the calling identity.
          <strong className="text-slate-600"> This controls the path through the app. It is not network isolation</strong> — an
          agent with another route out is not affected by it, which needs a sandbox the app layer cannot provide.
        </span>
      </div>

      <div className="flex gap-2">
        <Input
          value={newHost}
          onChange={(e) => setNewHost(e.target.value)}
          placeholder="api.example.com"
          className="text-sm h-9 flex-1 font-mono"
        />
        <Input
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Why is this allowed?"
          className="text-sm h-9 flex-1"
        />
        <Button size="sm" onClick={add} className="h-9 bg-slate-900 hover:bg-slate-700 text-white">
          <Plus className="w-3.5 h-3.5 mr-1" />
          Allow
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading allowlist...
        </div>
      ) : hosts.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">
          Allowlist is empty — every proxied outbound request is currently denied.
        </p>
      ) : (
        <div className="space-y-2">
          {hosts.map((h) => {
            const methods = Array.isArray(h.allowed_methods) ? h.allowed_methods : ['GET'];
            return (
              <div
                key={h.id}
                className={`rounded-xl border px-4 py-3 ${h.enabled === false ? 'bg-slate-50 border-slate-200' : 'bg-emerald-50 border-emerald-200'}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono font-semibold text-slate-700">{h.host}</span>
                    {methods.map((m) => (
                      <Badge key={m} className="bg-slate-800 text-white text-xs">{m}</Badge>
                    ))}
                    {h.enabled === false && (
                      <span className="text-xs text-slate-400 font-medium">disabled — blocked</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{h.request_count || 0} allowed</span>
                    <Switch checked={h.enabled !== false} onCheckedChange={(v) => toggleEnabled(h, v)} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => remove(h)}
                      className="h-7 text-xs border-red-200 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => toggleMethod(h, m)}
                      className={`text-xs px-2 py-0.5 rounded-md border font-medium ${
                        methods.includes(m)
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-500 border-slate-200'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                  {h.note && <span className="text-xs text-slate-400 italic ml-1">{h.note}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
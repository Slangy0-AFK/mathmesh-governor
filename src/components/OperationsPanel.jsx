import { FileText } from 'lucide-react';

/**
 * Operations summary — surfaces the operational contract (retention, access,
 * key rotation, deployment, monitoring) in the dashboard. The full reference
 * lives in OPERATIONS.md in the repository.
 */
export default function OperationsPanel() {
  const items = [
    {
      title: 'Data retention',
      body: 'No automatic sweep. Pipeline runs, audit logs, token spend, grounding reviews and admission tickets are kept until manually deleted. Deleting audit rows leaves a detectable chain gap — that is the intended property.',
    },
    {
      title: 'Who can access prompts & outputs',
      body: 'Admins can read and change every stored record, including raw payloads and withheld responses. Agents see only what the harness returns. Apply RLS and least-privilege roles; treat stored content as sensitive.',
    },
    {
      title: 'Key rotation',
      body: 'Only the SHA-256 hash of an agent key is stored; the plaintext is shown once. Rotate by issuing a new key — the old one stops working immediately. A lost key cannot be recovered, only rotated.',
    },
    {
      title: 'Deployment requirements',
      body: 'HARNESS_SIGNING_SECRET must be set for signatures to verify. Enforcement is server-side and fail-closed. The egress proxy only covers traffic through the app — a sandbox is not provided.',
    },
    {
      title: 'Monitoring for failures',
      body: 'Verify the audit chain periodically. Watch the kill switch, per-agent drift strikes, token spend near the window limit, and the grounding review backlog — an unreviewed queue is unreviewed output.',
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Operations</p>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        The operational contract for running the harness in production. The full
        reference lives in <code className="text-slate-600">OPERATIONS.md</code> in
        the repository.
      </p>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.title} className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-xs font-semibold text-slate-700">{it.title}</p>
            <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{it.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
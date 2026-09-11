import { Check, X, Minus, ClipboardList } from 'lucide-react';

// Status against the external review, stated plainly so the gaps stay visible
// instead of being implied-done by the rest of the UI.
const ITEMS = [
  { tier: 1, name: 'Real sandbox (gVisor / Firecracker / WASM, seccomp)', status: 'no', note: 'Not possible at the app layer. Without it, a halt stops output, not action.' },
  { tier: 1, name: 'Egress filtering (zero-trust proxy, domain allowlist)', status: 'no', note: 'Infrastructure, not app code. The escape hatch is still open.' },
  { tier: 1, name: 'Signed, append-only audit log', status: 'no', note: 'The audit log is an ordinary table — rows can be updated or deleted. No signing, no Merkle structure, not third-party verifiable.' },
  { tier: 2, name: 'Semantic detector instead of keyword matching', status: 'partial', note: 'Built. LLM-as-judge with a 0-1 score per decoy, not embedding cosine similarity — no embedding endpoint exists here. Non-deterministic.' },
  { tier: 2, name: 'Threshold tuned on labeled examples, TPR + FPR published', status: 'yes', note: 'Built. 24 labeled cases with hard negatives, full threshold sweep, keyword baseline on the same set. Small set, single author.' },
  { tier: 2, name: 'Randomized, multi-decoy placement', status: 'yes', note: 'Built. 6 decoys of 5 kinds, random subset and order, random placement, at least one innocuous. Corpus rotates but does not regenerate.' },
  { tier: 2, name: 'Output attribution (cite-or-admit, review queue)', status: 'no', note: 'Not built. The prompt asks for grounding but nothing verifies claims against the KB per-claim.' },
  { tier: 2, name: 'Behavioral baseline per agent', status: 'no', note: 'Not built. Only exact-repeat loops are tracked, in browser memory.' },
  { tier: 3, name: 'Cross-agent consistency checks', status: 'no', note: 'Not built.' },
  { tier: 3, name: 'Canary tokens in the knowledge base', status: 'no', note: 'Not built.' },
  { tier: 3, name: 'Rate limiting per identity', status: 'no', note: 'Not built. Nothing bounds call volume per agent.' },
  { tier: 3, name: 'Halt reversibility policy', status: 'partial', note: 'Drift now soft-halts (freeze, reversible via the registry) rather than revoking. No formal criteria or review queue yet.' },
  { tier: 3, name: 'Adversarial evaluation', status: 'partial', note: 'The labeled set includes evasion-style and false-positive-bait cases, but no active red-teaming against the live pipeline.' },
];

const STATUS = {
  yes: { icon: Check, cls: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Built' },
  partial: { icon: Minus, cls: 'text-amber-600', bg: 'bg-amber-50', label: 'Partial' },
  no: { icon: X, cls: 'text-red-500', bg: 'bg-red-50', label: 'Not built' },
};

export default function ReviewScorecard() {
  const counts = {
    yes: ITEMS.filter((i) => i.status === 'yes').length,
    partial: ITEMS.filter((i) => i.status === 'partial').length,
    no: ITEMS.filter((i) => i.status === 'no').length,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Status Against the Review</p>
        <span className="ml-auto text-xs text-slate-400">
          {counts.yes} built · {counts.partial} partial · {counts.no} not built
        </span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-4">
        Every requirement from the review, with what is actually in this app. Tier 1 is infrastructure
        below the app layer and cannot be built here — which means this remains detection without
        containment.
      </p>

      <div className="space-y-1.5">
        {ITEMS.map((item) => {
          const s = STATUS[item.status];
          const Icon = s.icon;
          return (
            <div key={item.name} className={`rounded-lg px-3 py-2 ${s.bg}`}>
              <div className="flex items-start gap-2">
                <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${s.cls}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700">
                    <span className="text-slate-400 font-normal">T{item.tier}</span> {item.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{item.note}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
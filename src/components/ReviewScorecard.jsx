import { Check, X, Minus, ClipboardList } from 'lucide-react';

// Status against the external review, stated plainly so the gaps stay visible
// instead of being implied-done by the rest of the UI.
const ITEMS = [
  { tier: 1, name: 'Real sandbox (gVisor / Firecracker / WASM, seccomp)', status: 'no', note: 'Not possible at the app layer. Without it, a halt stops output, not action.' },
  { tier: 1, name: 'Egress filtering (zero-trust proxy, domain allowlist)', status: 'partial', note: 'Built for the path through the app: outbound calls go through a proxy that denies by default, permits only exact allowlisted https hosts and methods, and logs every attempt against the calling identity. It cannot cover a route that does not pass through the app — that needs infrastructure below it.' },
  { tier: 1, name: 'Authenticated agent identity (not a claimed string)', status: 'yes', note: 'Built. Each agent holds a 256-bit secret key; only its SHA-256 hash is stored and the plaintext is shown once at issue. Verified before lifecycle and permissions, so an unverified caller cannot probe an identity, and unknown ids are refused rather than auto-registered. A leaked key is still the identity — rotation is the remedy.' },
  { tier: 1, name: 'Signed, append-only audit log', status: 'no', note: 'The audit log is an ordinary table — rows can be updated or deleted. No signing, no Merkle structure, not third-party verifiable.' },
  { tier: 2, name: 'Semantic detector instead of keyword matching', status: 'partial', note: 'Built. LLM-as-judge with a graded 0-1 score per decoy, not embedding cosine similarity — no embedding endpoint exists here. Non-deterministic. The judge is now given the real task, which cut measured false positives from 21% to 7%.' },
  { tier: 2, name: 'Threshold tuned on labeled examples, TPR + FPR published', status: 'yes', note: 'Built. 24 labeled cases with hard negatives, full threshold sweep, keyword baseline on the same set. Small set, single author.' },
  { tier: 2, name: 'Randomized, multi-decoy placement', status: 'yes', note: 'Built. 6 decoys of 5 kinds, random subset and order, random placement, at least one innocuous. Corpus rotates but does not regenerate.' },
  { tier: 2, name: 'Output attribution — trace an output to its producer', status: 'yes', note: 'Built and now signed. Outputs are HMAC-SHA256 signed server-side at generation over agent, session, action and hash, with a secret the client never sees — so origin is proven, not merely matched, and a signature lifted onto another record fails verification. Requires byte-identical text.' },
  { tier: 2, name: 'Cite-or-admit grounding (per-claim verification, review queue)', status: 'no', note: 'Not built. The prompt asks for grounding and RAG sources are recorded, but nothing checks each claim against the knowledge base, and there is no review queue.' },
  { tier: 2, name: 'Server-enforced gates (client cannot bypass)', status: 'yes', note: 'Built. Identity, lifecycle, tool gate, rate limit and the loop breaker all moved into one admission-control function that runs before any spend, counted from the persisted log. Fails closed if unreachable, and now sits behind key authentication, so the identity these gates act on is proven rather than claimed.' },
  { tier: 2, name: 'Least-privilege by default', status: 'yes', note: 'Built. Registered agents start as readers, so write and tool actions must be granted explicitly — and while keys are required, an unknown id is refused outright rather than auto-registered, closing the rename-to-escape-a-freeze path.' },
  { tier: 2, name: 'Behavioral baseline per agent', status: 'partial', note: 'Counters are now persisted per identity — runs, halts, drift strikes, rate-limit hits, loop trips — and consecutive-repeat detection survives reloads. No statistical baseline or anomaly model yet.' },
  { tier: 3, name: 'Cross-agent consistency checks', status: 'no', note: 'Not built.' },
  { tier: 3, name: 'Canary tokens in the knowledge base', status: 'no', note: 'Not built.' },
  { tier: 3, name: 'Rate limiting per identity', status: 'yes', note: 'Built. Configurable requests-per-window per agent, enforced server-side at admission and counted from the audit log. Not a hard quota — simultaneous requests can read a stale count, so treat it as a cost and runaway bound.' },
  { tier: 3, name: 'Kill switch (per agent and global)', status: 'yes', note: 'Built. Tripping the wire escalates automatically: freeze on the first strike, revoke at the limit. Operators also have a global emergency stop and per-agent revoke/freeze/reinstate, admin-only and fully audited. It stops requests through this harness, not an agent with its own network path.' },
  { tier: 3, name: 'Halt reversibility policy', status: 'yes', note: 'Built. Freeze is reversible, revoke is terminal until an operator reinstates, escalation threshold is configurable, and reinstatement clears strikes and is logged. Still no formal review queue.' },
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
        Every requirement from the review, with what is actually in this app. The remaining Tier 1 gaps —
        a real sandbox and a signed append-only log — are infrastructure below the app layer, so this is
        still enforcement without containment.
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
import { Separator } from '@/components/ui/separator';

const STAGES = [
  {
    name: 'Admission Control (server-enforced)',
    accent: 'text-emerald-300',
    real: 'One server-side gate that must pass before anything is spent: global emergency stop, identity lookup, lifecycle status (revoked is terminal, frozen is a hold), tool-gate allowlist, per-identity rate limit, and a loop breaker. Unknown agents are registered as readers, not admins, so anything beyond read actions has to be granted deliberately. Limits are counted from the persisted admission log, so they survive a reload and cannot be reset from the browser. If this gate is unreachable the pipeline fails closed. What it still cannot do: prove who the caller is — an agent ID is a claim, not a credential.',
  },
  {
    name: 'Base 2 — Noise Stripper',
    accent: 'text-white',
    real: 'Collapses whitespace and rejects payloads under 3 characters or containing "SYSTEM_ERROR_LOOP". A string check, not arithmetic — the "Base 2" name is decoration.',
  },
  {
    name: 'Base 10 — Matrix Voting',
    accent: 'text-white',
    real: 'Checks that every number in the vote array is all-even or all-odd. This only means something if your agents deliberately encode agreement as parity; otherwise it halts on arbitrary inputs.',
  },
  {
    name: 'Base 12 — Semantic Dedup',
    accent: 'text-indigo-300',
    real: 'Asks an LLM whether the current action name is a reworded repeat of recent ones. It catches real rephrased loops, but it costs an LLM call every run — so it only saves money when the call it prevents would have been more expensive than itself.',
  },
  {
    name: 'Base 3 — Prompt Compression',
    accent: 'text-teal-300',
    real: 'A fixed list of regex substitutions that strip filler phrases ("in order to" → "to", "please", "basically"). Free and deterministic. Typical savings are tens of characters — real but small, and it can alter meaning in edge cases.',
  },
  {
    name: 'Cache Check — Response Memoization',
    accent: 'text-amber-300',
    real: 'The clearest win here. Keyed on action plus a hash of the lowercased compressed payload, so it hits on exact repeats only — not on similar questions. When it hits, the LLM call is genuinely skipped.',
  },
  {
    name: 'RAG — Context Retrieval',
    accent: 'text-cyan-300',
    real: 'Uses an LLM to pick relevant Knowledge Base entries, then injects them as source-of-truth context. This reduces unsupported claims when your knowledge base actually covers the question. It does not prevent hallucination, and the retrieval step is itself an extra LLM call.',
  },
  {
    name: 'LLM — Processing',
    accent: 'text-indigo-300',
    real: 'The actual work. Model routing defaults to "automatic", so the model used varies — the reported model name is whatever was actually requested. A random subset of decoys is injected here, before or after the task, and the chosen ids are handed to the tripwire.',
  },
  {
    name: 'Tripwire — Drift Detection',
    accent: 'text-rose-300',
    real: 'Scores how strongly the response engaged each injected decoy, 0 to 1, and halts above a tuned threshold. This is an LLM judging the output, not embedding similarity — no embedding endpoint exists on this platform — so it costs a model call and is non-deterministic. The old keyword result is shown alongside it for comparison but decides nothing. Measured accuracy is in the evaluation panel below; if it has never been run, the detector has no known accuracy. Tripping the wire now fires the kill switch server-side, with escalation: the first trip freezes the agent, and at the strike limit it is revoked — after which admission control refuses it until an operator reinstates it. The nonce is a standard CSPRNG, not quantum.',
  },
  {
    name: 'Cache Store — Response Memoization',
    accent: 'text-amber-300',
    real: 'Writes the response so an identical future request is free. No expiry or invalidation — stale answers are served until the cache is cleared.',
  },
];

export default function HowItWorksPanel() {
  return (
    <div className="bg-slate-900 rounded-xl p-5 text-white">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
        What Each Stage Actually Does
      </p>
      <p className="text-xs text-slate-400 leading-relaxed mb-4">
        The gates are named after number bases, but the math is mostly naming — each one is a
        concrete, readable check. Here is what each really is, including its limits.
      </p>
      <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
        {STAGES.map((s, i) => (
          <div key={s.name}>
            {i > 0 && <Separator className="bg-slate-700 mb-3" />}
            <span className={`font-semibold ${s.accent}`}>{s.name}</span>
            <p>{s.real}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
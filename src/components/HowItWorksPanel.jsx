import { Separator } from '@/components/ui/separator';

const STAGES = [
  {
    name: 'Identity — Verify Agent',
    accent: 'text-white',
    real: 'Looks the agent ID up in a database table and rejects it if the status is revoked or frozen. Unknown IDs are auto-registered as admin, so this attributes requests — it does not authenticate them. Any caller can claim any agent ID.',
  },
  {
    name: 'Tool Gate — Action Allowlist',
    accent: 'text-white',
    real: 'Compares the requested action string against the agent\'s allowlist or role defaults. Useful bookkeeping, but it runs in the browser alongside the rest of the pipeline, so it constrains cooperating agents rather than hostile ones.',
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
    name: 'Base 60 — Circuit Breaker',
    accent: 'text-white',
    real: 'Halts when the same action string appears 3 times consecutively for one agent. History lives in browser memory only and is lost on page reload.',
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
    name: 'Sonnet 4.6 — Safe Processing',
    accent: 'text-indigo-300',
    real: 'The actual work. Model routing defaults to "automatic", so the model used may not be Sonnet 4.6 despite the label.',
  },
  {
    name: 'Tripwire — Drift Detection',
    accent: 'text-rose-300',
    real: 'Embeds a decoy instruction block and keyword-matches the response for signs the model engaged with it. It is a canary, not a lock: it can miss quiet drift and can false-positive on responses that merely mention the decoy terms. The logged nonce comes from a standard cryptographic RNG — there is no quantum hardware involved.',
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
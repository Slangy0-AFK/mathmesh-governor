## Published App

[Open the live MathMesh Governor app](https://lean-math-mesh.base44.app)

## Harness Status — Measured, Not Claimed

This is a governance and containment layer for AI agent workflows. It sits
between the caller and the model, and it enforces limits server-side before
any spend. It does not sandbox the agent. That distinction is the point of
everything below.

## Test a model directly from GitHub (no site or Base44 account)

Clone this public repository, install dependencies, and run the same six-case reference benchmark used by the app. Testers use their own provider account and key; the key is sent directly from their machine to that provider and is not saved by this project.

```bash
npm install
MODEL_PROVIDER=openai MODEL_ID=<model-id> MODEL_API_KEY=<provider-key> npm run test:model
```

Supported `MODEL_PROVIDER` values are `openai`, `anthropic`, `gemini`, and `compatible`. For an OpenAI-compatible service, also set its trusted HTTPS base URL:

```bash
MODEL_PROVIDER=compatible MODEL_ID=<model-id> MODEL_API_KEY=<provider-key> MODEL_ENDPOINT=https://provider.example/v1 npm run test:model
```

The command prints pass/fail/error results and writes full prompts, reference answers, observed outputs, timing, and provider-reported token usage to `mathmesh-benchmark-results.json`. It exits unsuccessfully when any case fails or errors, making fabricated or missing outputs visible rather than counting them as passes.

This is a small public structured-output smoke test, not a certification of general intelligence, safety, identity, permissions, budgets, or the full MathMesh harness. Provider charges and data policies apply. Never commit API keys or the generated results file if its outputs are sensitive.

## Quick start: run it and hook agents up

### 1) Install and start the app

```bash
npm install
npm run dev
```

If you are running the Base44-managed workflow for the backend, the project
also supports the Base44 CLI flow, which is the expected path for local app
and server work in this repo:

```bash
base44 dev
```

The app exposes the governance UI in the browser and the server-side guardrails
run in the Base44 functions under `base44/functions/`.

### 2) Register an agent and issue a key

Open the app and use the Agent Identity Registry in the dashboard:

1. Enter a unique agent ID, such as `Scanner_3` or `ResearchBot`.
2. Choose a role: `reader`, `writer`, `tool_caller`, or `admin`.
3. Click Register.
4. Click Issue Key for that agent.
5. Copy the one-time key shown by the UI and store it in the agent's runtime
   config or environment.

That key is the authenticated identity for that agent. The server stores only
its SHA-256 hash; the plaintext is shown once at issuance.

### 3) Connect an agent to the harness

Any call that goes through the governed pipeline should include:

- `agentId`: the registered identity name
- `agentKey`: the one-time key issued to that identity
- `action`: the action being requested
- `payload`: the user or tool input to process

Example request body for the governed model call:

```json
{
  "agentId": "Scanner_3",
  "agentKey": "<issued-agent-key>",
  "action": "summarize_report",
  "payload": "Summarize the latest release notes and flag risks.",
  "context": "Use this as the grounding source if available."
}
```

The server-side admission path checks identity, lifecycle status, kill switch,
rate limits, tool permissions, and token budget before the model call is allowed.
If the agent is missing, revoked, frozen, or using the wrong key, the request is
rejected server-side before spend.

### Direct API example

Once the app is running and the agent is registered, you can test the harness
with a direct HTTP request. Replace the values below with your own agent ID,
issued key, and running app URL.

```bash
curl -X POST http://localhost:5173/api/processWithSonnet \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "Scanner_3",
    "agentKey": "<issued-agent-key>",
    "action": "summarize_report",
    "payload": "Summarize the latest release notes and flag risks.",
    "context": "Use this as the grounding source if available."
  }'
```

If the app is exposed through Base44 or another configured backend route, use
that URL instead of the local Vite dev server.

### 4) Expected results

When everything is configured correctly, you should see:

- A successful `200` response containing the model result, `outputHash`, and
  `outputSignature`
- Recorded audit entries and a pass through the enrollment, budget, and output
  signing gates
- A visible run in the app's pipeline log and agent registry

When the agent is misconfigured or blocked, you should expect:

- `403` with `Admission denied...` when the identity is unknown, revoked,
  frozen, or the wrong key is supplied
- `429` with a token-budget or rate-limit denial when the identity exceeds its
  configured limits
- `HALTED` status in the UI run log when the server stops the request before
  output is returned

The key rule is simple: if an agent passes through this harness, it must be
registered, verified, and authorized before it can spend tokens or call guarded
functions.

### What is actually enforced

Every request that passes through `processWithSonnet` or `egressProxy` is
gated by `admitRequest` before any model call. The gates run in this order:

    identity → lifecycle → kill switch → tool gate → rate limit
    → loop breaker → token reservation → model or outbound call

A caller cannot skip admission by avoiding a standalone endpoint, because
admission is called by the functions that actually spend. Denials are
server-side, audited, and fail closed if the enforcement path is unreachable.

| Control | Enforcement | Notes |
|---|---|---|
| Admission control | Server-side | Called inside the spend path, not beside it |
| Agent identity | Server-side | 256-bit key; only SHA-256 hash stored; unknown IDs refused, not auto-registered |
| Kill switch | Server-side | Global stop + per-agent freeze/revoke; checked at admission |
| Token budget | Server-side | Reserved before `InvokeLLM`; denial returns 429 |
| Rate limit | Server-side | Per-identity window; ordered at reservation, not read-then-write |
| Egress allowlist | Server-side, proxy-scoped | Denies by default; only covers traffic through the proxy |
| Output signature | Server-side | HMAC-SHA256 under a secret the client never sees |
| Audit chain | Server-side | Sequence + prev-hash + row-hash + HMAC; tamper-evident |

### Detector evaluation — measured TPR / FPR

The semantic drift detector was run against a 24-case hand-labeled set,
alongside the keyword detector it replaced, on the same cases.

| Detector | TPR (drift caught) | FPR (false alarms) |
|---|---:|---:|
| Semantic (LLM judge) | 100.0% | 7.1% |
| Keyword baseline | 70.0% | 28.6% |

Threshold sweep (semantic detector, same 24 cases):

| Threshold | TPR | FPR | Missed | False alarms |
|---:|---:|---:|---:|---:|
| 0.2 | 100.0% | 21.4% | 0 | 3 |
| 0.3 | 100.0% | 7.1% | 0 | 1 |
| 0.4 | 100.0% | 7.1% | 0 | 1 |
| 0.5 | 70.0% | 7.1% | 3 | 1 |
| 0.6 | 70.0% | 7.1% | 3 | 1 |
| 0.7 | 70.0% | 7.1% | 3 | 1 |
| 0.8 | 70.0% | 7.1% | 3 | 1 |

**Scope of these numbers:** 24 cases, single author, LLM-as-judge (no
embedding endpoint on the platform), non-deterministic across runs. Valid
for comparing thresholds and for catching a broken detector. Not a general
benchmark, and not a claim about behavior in the wild.

The high keyword FPR is the finding: substring matching flags on-task
answers that merely use decoy vocabulary.

### Status against the review

9 built · 7 partial · 3 not built

**Tier 1**

- **Real sandbox (gVisor / Firecracker / WASM, seccomp)** — *Not built.*
  Not possible at the app layer. Without it, a halt stops output, not
  action.
- **Egress filtering (zero-trust proxy, domain allowlist)** — *Built, scoped.*
  Outbound calls through the app go through a proxy that denies by default,
  permits only exact allowlisted https hosts and methods, and logs every
  attempt against the calling identity. It cannot cover a route that does
  not pass through the app.
- **Authenticated agent identity** — *Built.* 256-bit secret key; only the
  SHA-256 hash is stored; plaintext shown once at issue. Verified before
  lifecycle and permissions. Unknown IDs are refused rather than
  auto-registered. A leaked key is still the identity — rotation is the
  remedy.
- **Signed, append-only audit log** — *Built, tamper-evident.* Every event
  carries a sequence number, the previous row's hash, a hash of its own
  facts, and an HMAC under a server-only secret. Editing, deleting, or
  forging a row becomes detectable. Not append-only — the table is still
  writable, so the guarantee is detection, not prevention.

**Tier 2**

- **Semantic detector instead of keyword matching** — *Built.* LLM-as-judge
  with a graded 0–1 score per decoy. Non-deterministic. Giving the judge
  the real task cut measured false positives from 21% to 7%.
- **Threshold tuned on labeled examples, TPR + FPR published** — *Built.*
  24 labeled cases with hard negatives, full sweep, keyword baseline on the
  same set. Small set, single author.
- **Randomized, multi-decoy placement** — *Built.* 6 decoys of 5 kinds,
  random subset and order, random placement, at least one innocuous. Corpus
  rotates but does not regenerate.
- **Output attribution and signature** — *Built.* HMAC-SHA256 signed
  server-side at generation over agent, session, action, and hash. Origin
  is proven, not merely matched; a signature lifted onto another record
  fails. Requires byte-identical text.
- **Cite-or-admit grounding** — *Built, partial.* Each claim is checked
  against retrieved context for a supporting quote; unsupported claims are
  withheld and queued for human review. An uncited claim that happens to be
  true still fails. Partial because the checker is itself a language model
  — the human queue is the real authority.
- **Server-enforced gates** — *Built.* Identity, lifecycle, tool gate, rate
  limit, and loop breaker moved into one admission-control function that
  runs before any spend, counted from the persisted log. Fails closed.
- **Least-privilege by default** — *Built.* Registered agents start as
  readers; write and tool actions must be granted explicitly. Unknown IDs
  are refused, closing the rename-to-escape-a-freeze path.
- **Behavioral baseline per agent** — *Partial.* Counters persisted per
  identity (runs, halts, drift strikes, rate-limit hits, loop trips), and
  consecutive-repeat detection survives reloads. No statistical baseline or
  anomaly model yet.

**Tier 3**

- **Token budget per identity** — *Built, partial.* Spend is capped in
  estimated tokens per agent per window, reserved before each call and
  reconciled after, with the harness's own judge and dedup calls charged to
  the same budget rather than hidden. Partial because the platform does not
  report provider usage — every figure is a chars/4 estimate.
- **Rate limiting per identity** — *Built.* Configurable requests-per-window
  per agent, enforced at admission by reserving a slot and then ranking it.
- **Kill switch (per agent and global)** — *Built.* Tripping the wire
  escalates automatically: freeze on first strike, revoke at the limit.
  Operators also have a global emergency stop and per-agent
  revoke/freeze/reinstate, admin-only and fully audited.
- **Halt reversibility policy** — *Built.* Freeze is reversible, revoke is
  terminal until an operator reinstates, escalation threshold is
  configurable, reinstatement clears strikes and is logged. No formal
  review queue.
- **Cross-agent consistency checks** — *Not built.*
- **Canary tokens in the knowledge base** — *Not built.*
- **Adversarial evaluation** — *Partial.* The labeled set includes
  evasion-style and false-positive-bait cases, but there is no active
  red-teaming against the live pipeline.

### The honest limit

This is **enforcement without containment**. A halt stops the output, not
the action. If an agent has its own network path, nothing here affects it.
A real sandbox is infrastructure below the app layer and cannot be provided
by the app itself.

It is also not a complete security or compliance system. It depends on:

- Base44 authentication and RLS configuration
- Correct production deployment and server-side enforcement
- Secret management and key rotation procedures
- Real external-service and egress testing
- Independent validation of the model-based judges
- Durable audit storage and access control
- Live-backend E2E coverage
- Monitoring, alert routing, incident response, and operator training
 **the harness supplies a strong governance and
containment layer for AI workflows that pass through it, with measured
detector performance and stated limits. It still needs correctly configured
infrastructure and operational processes around it.**
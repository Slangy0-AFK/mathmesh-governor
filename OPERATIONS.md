# Operations — MathMesh Governor

This document covers what an operator needs to run the harness in production. It
is the counterpart to the README's "what is enforced": enforcement is only as
trustworthy as the operational process around it.

## Data retention

| Data | Where | Retention | Notes |
|---|---|---|---|
| Pipeline runs | `PipelineRun` entity | Indefinite until manually deleted | Contains raw + clean payloads and LLM responses. Delete old runs if payloads are sensitive. |
| Audit log | `AuditLog` entity | Indefinite until manually deleted | Tamper-evident, not append-only. Deletion leaves a detectable sequence gap. |
| Token spend | `TokenSpend` entity | Indefinite until manually deleted | Estimated counts, not a provider bill. Refunded rows are kept for forensics. |
| Agent identities | `AgentIdentity` entity | Indefinite until manually deleted | Only the SHA-256 key hash is stored; the plaintext key is never stored. |
| Admission tickets | `AdmissionTicket` entity | Grow over time | One-time-use; consumed rows can be periodically purged. |
| Grounding reviews | `GroundingReview` entity | Indefinite until manually deleted | Holds the withheld response text so a reviewer can judge it without rerunning. |
| Knowledge base | `KnowledgeBase` entity | Indefinite until manually deleted | The grounding source of truth. |
| Response cache | `ResponseCache` entity | Indefinite until manually cleared | No expiry or invalidation — stale answers are served until cleared. |
| Egress allowlist | `EgressAllowlist` entity | Indefinite until manually deleted | Hosts an agent may reach through the proxy. |
| Drift eval results | `DriftEvalResult` entity | Indefinite until manually deleted | Measured TPR/FPR per evaluation run. |

There is no automatic retention sweep. If payloads or responses must not live
forever, schedule a periodic deletion of old `PipelineRun`, `GroundingReview`,
`TokenSpend`, and `AdmissionTicket` rows. Deleting `AuditLog` rows is detectable
through the chain verifier (a sequence gap), which is the intended property.

## Who can access stored prompts and outputs

- **App users**: governed by Base44 authentication and Row-Level Security. The
  dashboard surfaces are admin-gated where they spend credits or reveal controls.
- **Admins**: can read and change every entity above, including raw payloads,
  withheld responses in the grounding queue, and audit history.
- **Agents**: an agent sees only what the harness returns to it. Withheld
  responses are not returned to the calling agent; they land in the review queue.
- **Base44 platform**: the app runs on Base44, so Base44 infrastructure has access
  to stored data under the platform's own access and compliance controls.

Treat stored prompts and responses as sensitive: they may contain user content.
Apply RLS and least-privilege roles, and restrict admin access to the people who
need it for operations and review.

## Key rotation

- Each agent identity has one secret key at a time. Only the SHA-256 hash is
  stored; the plaintext is shown once at issue time and never again.
- Rotate a key by issuing a new one for the agent. The previous key stops working
  immediately. Update the agent's runtime config with the new key.
- A lost key cannot be recovered — rotate it. A leaked key is still the identity;
  rotation is the remedy, not deletion of the agent (which would lose its history).
- For a compromised identity, use the kill switch (freeze or revoke) instead of
  just rotating. Revoke is terminal until an operator reinstates it.
- The audit signing secret (`HARNESS_SIGNING_SECRET`) is a platform secret. If it
  is rotated, rows signed under the old secret will verify as `bad_signature`
  against the new one — re-signing historical rows is not supported, so rotate
  only when you accept that trade-off, or keep the old secret available for
  historical verification.

## Deployment requirements

- The app is published on Base44 and served from there. There is no separate
  server to host; the backend functions run on the platform.
- `HARNESS_SIGNING_SECRET` must be set for audit-chain and output signatures to
  verify. Without it, rows are still chained but reported as `unsigned`.
- Enforcement is server-side and fail-closed: if the admission path is
  unreachable, requests are denied. There is no client-only mode that bypasses it.
- The egress proxy only covers traffic that passes through the app. Agents with
  their own network route are unaffected — that needs a sandbox below the app
  layer, which this app does not provide.
- Token limits are estimated (chars/4), not a provider bill. The platform does
  not report provider usage, so treat every budget number as an estimate.

## Monitoring for failures

- **Audit chain**: run `verifyAuditChain` (or the Audit Chain Integrity panel)
  periodically. A broken link, sequence gap, or bad signature means history was
  edited, deleted, or forged — investigate before trusting any later claim.
- **Kill switch**: watch `HarnessControl.kill_all` and per-agent `status`. A
  revoked agent is terminal until reinstated; a frozen agent is a reversible hold.
- **Token budget**: monitor `TokenSpend` per agent. Sustained spend near the
  window limit signals either heavy use or a runaway loop the breaker did not catch.
- **Drift**: watch `AgentIdentity.drift_count` and the tripwire halts in the run
  log. Drift escalates: freeze on first strike, revoke at the configured limit.
- **Grounding queue**: a growing `GroundingReview` backlog means the checker is
  withholding responses faster than a human reviews them — the human is the
  authoritative tier, so an unreviewed queue is unreviewed output.
- **Detector accuracy**: run `runDriftEval` against the tuning and held-out sets
  after any change to the detector or judge prompt. A drop in TPR or a rise in FPR
  on the held-out set is the signal that a change regressed detection.

## Incident response

1. If an agent is misbehaving, freeze it (reversible) or revoke it (terminal)
   from the Agent Identity Registry. Both are audited.
2. If the whole harness must stop, engage the global emergency stop
   (`HarnessControl.kill_all`). Every request is then denied before any spend.
3. If the audit chain reports tampering, treat all verdicts after the break as
   unverified and investigate which event was altered or removed.
4. If a key may be compromised, rotate it and review that agent's recent runs
   for drift or unexpected spend.
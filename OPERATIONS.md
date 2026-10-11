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

### Error tracking and metrics

- Configure `VITE_SENTRY_DSN` in each frontend build to enable browser error
  reporting. It is a public project identifier and will be present in the bundle;
  do not put credentials in `VITE_*` variables.
- Store `SENTRY_DSN` and `APP_ENV` as Base44 server secrets to enable exception
  reporting for `processWithSonnet`, `egressProxy`, and the metrics exporter.
  Events exclude default PII; backend logs contain JSON error type/function fields
  and do not include request payloads.
- Store a high-entropy `PROMETHEUS_SCRAPE_TOKEN` as a Base44 secret and the same
  value in the Prometheus scraper's secret store. `GET /api/metrics` requires it
  as a bearer token and emits gauges aggregated over at most the newest 1,000
  retained `PipelineRun` records. These are retained-record snapshots, not
  lifetime counters or provider billing data. Scrape no more frequently than
  once per minute to bound database reads.
- `GET /api/health` is a liveness check only. A successful response means the
  function runtime responded; it does not prove model providers or data services
  are healthy.

Example Prometheus scrape configuration (keep the token in a mounted secret
file, not in source control):

```yaml
scrape_configs:
  - job_name: mathmesh-governor
    metrics_path: /api/metrics
    scheme: https
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/mathmesh_scrape_token
    static_configs:
      - targets: [lean-math-mesh.base44.app]
```

## Incident response

1. Triage the alert in Sentry or the Base44 function logs. Record the affected
  function, time window, release revision, and relevant audit sequence numbers;
  do not copy prompts, keys, or raw user content into an incident ticket.
2. If an agent is misbehaving, freeze it (reversible) or revoke it (terminal)
  from the Agent Identity Registry. Both are audited.
3. If the whole harness must stop, engage the global emergency stop
  (`HarnessControl.kill_all`). Every request is then denied before any spend.
4. If the audit chain reports tampering, treat all verdicts after the break as
  unverified and investigate which event was altered or removed.
5. If a key or monitoring token may be compromised, rotate it in the owning
  secret store, update the dependent scraper/runtime, and review recent runs for
  drift or unexpected spend. Revoke a compromised agent identity as needed.
6. Preserve relevant logs and audit records, notify the designated incident
  owner, and document containment and recovery actions before closing the event.

## Rollback procedure

1. Contain unsafe behavior first: freeze/revoke affected agents or engage the
  global emergency stop. A code rollback does not stop an already active agent.
2. Identify the last known-good commit from the release record and confirm the
  issue is code-related. Check entity/schema changes and secrets separately;
  restoring code does not automatically reverse data changes or rotate secrets.
3. Revert the bad change through a reviewed Git revert commit, run CI, and deploy
  that known-good revision to the intended Base44 app using the normal release
  procedure (`npx base44 deploy --build -y`). Confirm the CLI is linked to the
  correct environment before deploying.
4. Verify `/api/health`, sign-in, admission denial/allow behavior, the audit
  chain, and the global stop in the target environment. Keep the stop engaged
  until those checks pass, then release it under operator review.
5. Record the deployed revision, verification evidence, and any manual data or
  secret recovery. If rollback does not restore safe operation, leave the stop
  engaged and escalate to Base44 support and the incident owner.

There is no automated deployment or platform rollback workflow in this
repository today. Treat entity/data migrations as forward-only until a tested
recovery plan exists.
## External Evaluation Deployment

Use a separate Base44 deployment, synthetic data, and dedicated reviewer
accounts for external testing. Confirm authentication, entity roles, row-level
access rules, and reviewer access in that deployment; this repository cannot
prove the deployed permissions are correct. Do not share production
administrator credentials with reviewers.

Keep `HARNESS_SIGNING_SECRET` and provider credentials in server-side secret
stores. Never place them in `VITE_*` variables, browser code, prompts, logs, or
committed files. The one-time agent key belongs in the agent runtime's secret
store; rotate it if it is lost or may have been exposed.

The live E2E suite mutates test data and briefly toggles the global emergency
stop. It requires explicit `E2E_RUN_LIVE=true` and `E2E_ALLOW_MUTATIONS=true`,
credentials, and an HTTPS `E2E_BASE_URL`; it blocks the published production
URL. The SDK-backed checks additionally require
`VITE_E2E_EXPOSE_BASE44=true` on the test deployment build only. Verify that
this flag is absent from production builds. Review the test report and confirm
probe cleanup after every live run.

Before accepting traffic or a lab run, verify the key requirement, per-agent
permissions, request and estimated-token limits, global stop, egress behavior,
and output review in the deployed app. Set provider-side billing alerts and
limits separately. Define who responds to unexpected allows or denials, key
exposure, a broken audit chain, provider outage, or test cleanup failure. Keep
a known-good revision and test rollback before changing a live deployment.

## Claims to State Accurately

- Audit records are tamper-evident, not append-only or immutable.
- Usage limits are estimates, not provider-reported billing caps.
- Egress restrictions cover calls routed through this app's proxy only.
- A stopped request does not stop an agent that can act outside this app.
- Sentry reporting and Prometheus scraping are optional integrations and require
  operator configuration, alert rules, and on-call ownership.
- The repository does not provide automatic incident response, independent
  security review, or a safety certification.

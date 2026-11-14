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

- **Administrators**: authenticated by server-issued bearer sessions. Entity CRUD
  and protected functions enforce administrator role in the API.
- **Admins**: can read and change every entity above, including raw payloads,
  withheld responses in the grounding queue, and audit history.
- **Agents**: an agent sees only what the harness returns to it. Withheld
  responses are not returned to the calling agent; they land in the review queue.
- **Database operators**: anyone with direct PostgreSQL access can bypass API
  checks. Restrict credentials, network access, and backups accordingly.

Treat stored prompts and responses as sensitive: they may contain user content.
Restrict administrator access to the people who need it for operations and
review. The generic PostgreSQL table does not apply row-level security.

## Key rotation

- Each agent identity has one secret key at a time. Only the SHA-256 hash is
  stored; the plaintext is shown once at issue time and never again.
- Rotate a key by issuing a new one for the agent. The previous key stops working
  immediately. Update the agent's runtime config with the new key.
- A lost key cannot be recovered — rotate it. A leaked key is still the identity;
  rotation is the remedy, not deletion of the agent (which would lose its history).
- For a compromised identity, use the kill switch (freeze or revoke) instead of
  just rotating. Revoke is terminal until an operator reinstates it.
- The audit signing secret (`HARNESS_SIGNING_SECRET`) is a server environment
  secret. If it
  is rotated, rows signed under the old secret will verify as `bad_signature`
  against the new one — re-signing historical rows is not supported, so rotate
  only when you accept that trade-off, or keep the old secret available for
  historical verification.

## Deployment requirements

- Run Node.js 22 or later with PostgreSQL. `npm run dev` starts the API and
  Vite frontend; `npm start` starts the API and serves the production build.
- Configure `DATABASE_URL`, `AUTH_SECRET` (at least 32 bytes),
  `HARNESS_SIGNING_SECRET`, initial admin credentials, and model provider
  credentials as server environment variables.
- The initial admin is seeded on startup. Public registration is disabled.
  Rotate `AUTH_SECRET` to invalidate existing bearer sessions.
- Entity CRUD and protected functions check the authenticated administrator
  role. The API does not provide database row-level security; direct SQL access
  is privileged and must be restricted separately.
- Keep PostgreSQL private, require TLS for remote database connections, and
  terminate public TLS at a trusted reverse proxy.
- Enforcement fails closed when admission is unavailable. The egress proxy
  only covers traffic that passes through it; it does not sandbox agents. It
  requires every DNS answer to be public and pins the connection to a checked
  address. DNS failures and mixed public/private answers are blocked.
- Token limits are estimated (chars/4), not a provider bill. Configure provider
  billing alerts and spend caps separately. PostgreSQL serializes concurrent
  reservations for each agent across application instances; actual usage may
  still exceed an estimate when a model call is reconciled.
- CI exercises concurrent reservations against PostgreSQL. To run that test
  locally, set `TOKEN_LEDGER_TEST_DATABASE_URL` to a disposable test database
  before running `npm run test:unit`; it creates application tables there.

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

### Error tracking and health

- The API writes structured error type and function information to standard
  error without including request payloads. Route logs to the operator's chosen
  protected log store.
- `VITE_SENTRY_DSN` can enable optional browser error reporting. It is public
  configuration, not a credential; never put secrets in `VITE_*` variables.
- `GET /api/health` checks API and database liveness. It does not prove model
  provider availability.

Example Prometheus scrape configuration (keep the token in a mounted secret
file, not in source control):

```yaml
scrape_configs:
  - job_name: mathmesh-governor
    metrics_path: /api/health
    scheme: https
    static_configs:
      - targets: [your-governor-host.example]
```

## Incident response

1. Triage the alert in the configured browser monitor or protected server logs. Record the affected
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
  the API and frontend together using the operator's documented release process.
4. Verify `/api/health`, sign-in, admission denial/allow behavior, the audit
  chain, and the global stop in the target environment. Keep the stop engaged
  until those checks pass, then release it under operator review.
5. Record the deployed revision, verification evidence, and any manual data or
  secret recovery. If rollback does not restore safe operation, leave the stop
  engaged and escalate to the incident owner.

There is no automated deployment or rollback workflow in this repository.
Treat database migrations as forward-only until a tested recovery plan exists.
## External Evaluation Deployment

Use a separate deployment, PostgreSQL database, synthetic data, and dedicated
administrator account for external testing. Do not share production
administrator credentials with reviewers.

Keep `HARNESS_SIGNING_SECRET` and provider credentials in server-side secret
stores. Never place them in `VITE_*` variables, browser code, prompts, logs, or
committed files. The one-time agent key belongs in the agent runtime's secret
store; rotate it if it is lost or may have been exposed.

The live E2E suite mutates test data and briefly toggles the global emergency
stop. It requires explicit `E2E_RUN_LIVE=true` and `E2E_ALLOW_MUTATIONS=true`,
credentials, and an HTTPS `E2E_BASE_URL`. It exercises the authenticated API
directly and requires no browser-injected test hook or special build mode.
Review the report and confirm probe cleanup after each run.

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

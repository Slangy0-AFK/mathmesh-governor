# Lab Evaluation Guide

This guide separates tests of this repository from claims that require an
independent evaluator. Results apply only to the exact revision, deployment,
provider settings, and test data used for a run.

## Run the Checks

Install the locked dependencies and run the deterministic tests and app build:

```bash
npm ci
npm run test:unit
npm run build
```

The unit tests exercise the token ledger and reference-answer scoring without
calling a model or changing deployed data.

Run the browser smoke tests with:

```bash
npm run test:e2e
```

These tests check that the app loads and routes correctly. They return a 404 for
backend API requests and do not test live controls.

The live checks require a dedicated Base44 test deployment, an administrator
account for that deployment, and provider model access for the signed self-test.
Set these variables in a private shell or CI secrets store, never in a committed
file:

```bash
export E2E_BASE_URL="https://your-test-deployment.example"
export E2E_AUTH_EMAIL="your-test-admin@example.com"
export E2E_AUTH_PASSWORD="your-test-password"
export E2E_RUN_LIVE="true"
npm run test:e2e:enforcement
```

The live suite checks that an unknown agent is refused before a response or
token-ledger entry is produced, then runs the seven-case signed self-test and
requires every case to pass. The self-test makes model calls and may incur
provider charges. Do not point it at production or real user data.

To compare a model with the public structured-output reference cases, see the
`npm run test:model` instructions in the README. That command uses the provider
account and key supplied by the tester and may incur provider charges.

## Current Evidence Limits

- The reference model benchmark is version `mathmesh-reference-v3` and contains
  ten cases. It checks exact answer values and output format; the cases are
  author-written, not independently selected or held out, and do not make this a
  general capability or safety evaluation.
- The drift evaluation uses 24 hand-labeled cases written by the same author as
  the detector. It is suitable for debugging and threshold comparison, not for
  claims about performance on other models or real deployments.
- The signed self-test has seven model-backed cases. The requested judge model
  is recorded, but the report does not independently verify which model weights
  the provider used.
- The live E2E suite covers unknown-agent denial and the signed self-test. It
  does not yet automate the full frozen/revoked, tool permission, request-limit,
  token-budget, global-stop, egress, or human-review matrix.
- The browser smoke tests do not contact a live backend. A green result from
  those tests is not evidence that server controls work.
- Token amounts are estimates based on text length, not provider billing data.
- The audit record is tamper-evident, not append-only. Changes can be detected;
  the app does not prevent every change to stored rows.
- There is no sandbox. Controls apply to requests routed through this app and do
  not govern activity outside it.
- No independent laboratory evaluation has been completed by this repository.

## What to Record

For each evaluation, keep the source revision, deployment identifier, date,
provider and requested model, policy settings, test-set version, command, full
pass/fail/error counts, and the generated report. Redact secrets and any prompt
or response data that the reviewer is not authorized to receive. Report false
alarms, missed detections, and errors separately; do not combine errors with
passes.

For an independent evaluation, ask reviewers to use test cases that were not
used to tune the detector, repeat model-backed runs, inspect failures, and
publish the exact scope and setup. Keep their results separate from the
repository's author-written cases.
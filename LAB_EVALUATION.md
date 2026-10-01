# Lab Evaluation Guide

This guide separates tests of this repository from claims that require an
independent evaluator. Results apply only to the exact revision, deployment,
provider settings, and test data used for a run.

## Run the Checks

Install the locked dependencies and run the deterministic tests and app build:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

The unit tests exercise admission, token accounting, audit-chain verification,
and reference-answer scoring without calling a model or changing deployed data.

Run the browser smoke tests with:

```bash
npm run test:e2e
```

These tests check that the app loads and routes correctly. They return a 404 for
backend API requests and do not test live controls.

The live suite has 13 checks: 11 backend checks for identity/key validation,
agent lifecycle, tool permissions, rate and estimated-token limits, the global
stop, denied-request spend, audit-verification response shape, egress, and human
review; plus two UI checks for unknown-agent denial and the signed self-test.
The signed self-test needs provider model access. These checks mutate data and
temporarily toggle the global stop, so use only a dedicated HTTPS Base44 test
deployment with synthetic data. The published production URL is explicitly
blocked. Build that test deployment with `VITE_E2E_EXPOSE_BASE44=true` to enable
the SDK-backed checks; do not set it on production.

Set these variables in a private shell or CI secrets store, never in a committed
file:

```bash
export E2E_RUN_LIVE="true"
export E2E_ALLOW_MUTATIONS="true"
export E2E_BASE_URL="https://your-test-deployment.example"
export E2E_AUTH_EMAIL="your-test-admin@example.com"
export E2E_AUTH_PASSWORD="your-test-password"
npm run test:e2e:enforcement
```

Live mode fails fast unless the target, credentials, and mutation confirmation
are all present. Without `E2E_RUN_LIVE=true`, the live tests are skipped. Review
the Playwright report and confirm cleanup completed before accepting results.
The signed self-test makes model calls and may incur provider charges.

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
- The live E2E suite automates a bounded control matrix, not every policy,
  configuration, failure mode, or adversarial condition. A passing run is not
  evidence of complete enforcement or production security.
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
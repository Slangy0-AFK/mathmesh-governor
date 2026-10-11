# Contributing

## Local Setup

Use Node.js 20 or newer and npm:

```bash
npm ci
npm run dev
```

Before opening a pull request, run the repository checks:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Pull requests also run secret scanning, filesystem vulnerability/configuration
scanning, and dependency review. Bandit runs when Python source files are added.

## Changes and Pull Requests

- Keep changes focused and include tests for behavior changes.
- Describe user impact, security implications, and any required Base44 secret or
  entity configuration.
- Never include credentials, real user data, prompts, or model outputs in tests,
  fixtures, logs, or screenshots.
- Do not run the live enforcement suite against production. It mutates test data
  and changes the global emergency stop; use its explicitly configured staging
  environment only.
- Run the manual k6 workflow only against the staging environment. It is a
  bounded availability check, not a production capacity certification.
- Update `OPERATIONS.md` when a change affects deployment, alerting, incident
  handling, or rollback.

## Environments

Configure distinct GitHub Environments named `development`, `staging`, and
`production`, with separate Base44 app IDs and credentials. Require reviewers
and restrict deployment branches for production. The repository currently uses
`staging` for live enforcement and manual load tests; it does not yet automate
Base44 deployments.
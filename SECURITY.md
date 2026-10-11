# Security Policy

## Reporting a Vulnerability

Do not report suspected vulnerabilities in a public issue or pull request.
Use this repository's GitHub private vulnerability reporting or security
advisory feature. If it is unavailable, contact the repository maintainers
privately through GitHub and ask for a secure reporting channel.

Include the affected component, impact, reproduction steps, and any relevant
logs with secrets and user content removed. The maintainers will acknowledge
reports as soon as practical, investigate privately, and coordinate a fix and
disclosure timeline with the reporter. Do not access, modify, or retain data
that is not yours while validating a report.

## Secret Handling

- Keep Base44, provider, Sentry, Prometheus, and test credentials in the
  platform's secret store or the appropriate GitHub Environment.
- Never commit `.env` files, live test credentials, agent keys, or raw prompts
  and outputs from real users.
- Treat `VITE_*` values as public browser configuration. The Sentry browser DSN
  may be public; credentials and server-side DSNs must not use this prefix.
- Rotate exposed credentials promptly and review recent agent runs and audit
  events. See [OPERATIONS.md](OPERATIONS.md) for incident response and rollback.

## Supported Scope

Security reports are welcome for the application and workflows in this
repository. Base44 platform vulnerabilities should be reported to Base44 through
its security reporting channel. This application is not a sandbox and cannot
control agent activity outside requests routed through it.
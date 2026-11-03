# AGENTS.md

## Project Context

This is a self-hosted Node.js and PostgreSQL application. Keep changes focused, preserve existing conventions, and consult `README.md` and `OPERATIONS.md` for local setup and deployment.

## Key Files

- `src/`: frontend application source.
- `server/`: standalone API, authentication, PostgreSQL, and model-provider runtime.
- `governor/`: governance handlers and shared policy logic.
- `src/api/appClient.js`: frontend client for the local API.
- `vite.config.js`: Vite config and local API proxy.
- `.env.local`: local-only environment values; never commit secrets.

## Working Notes

- Use `npm run dev` to run the local API and frontend together; the API requires PostgreSQL and server-side environment variables.
- Use `npm run dev:e2e` only for frontend browser smoke tests without a backend.
- Run the relevant checks from `package.json` before finishing code changes.

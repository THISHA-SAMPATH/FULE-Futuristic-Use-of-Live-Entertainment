# Deployment

## Required production services

- Node.js 22 backend container with a writable temporary directory only.
- Managed PostgreSQL (`DATABASE_URL`) and Redis (`REDIS_URL`) with private networking, TLS where supported, backups, and monitoring.
- One exact HTTPS frontend origin in `FRONTEND_ORIGIN`.
- Secret manager values for `JWT_ACCESS_SECRET`, Twitch credentials, OpenAI, dispatch/Twilio integrations, `METRICS_TOKEN`, and optional `SENTRY_DSN`.

Do not enable `DEMO_MODE` on a public deployment. Do not set `FULE_DEMO_GUARDIAN_INVITE` or `FULE_LOAD_TEST_TOKEN` outside local demos/tests. Create the first admin with the one-time operational command `npm --prefix backend run create:admin`, then remove the bootstrap credential from the runtime environment. Admin access is needed to approve guardian accounts.

## Build and run

The repository includes `backend/Dockerfile`, `frontend/Dockerfile`, and `docker-compose.yml` for local development. Production platforms should build those images and inject runtime values. Backend startup runs Knex migrations; deploys should first take a PostgreSQL backup and canary the new image before shifting all traffic.

Set `FRONTEND_ORIGIN=https://<frontend-domain>` exactly, and add the exact Twitch OAuth redirect URL `https://<api-domain>/auth/twitch/callback` in the Twitch Developer Console. Vercel frontend build values are `VITE_API_URL=https://<api-domain>` and `VITE_DEMO_MODE=false`; `VITE_` values are public.

Set `DATABASE_URL` and `REDIS_URL` to managed services. Production intentionally fails at startup if either is absent. Configure PostgreSQL connection pool size for the service's connection budget (`PG_POOL_MAX`), and retain PostgreSQL connections below the database limit across all app instances. Redis must be shared by API instances to coordinate rate limits, socket fan-out, BullMQ work, and broadcaster EventSub ownership. If Twitch integration is enabled, generate and set `TWITCH_TOKEN_ENCRYPTION_KEY` as 32 random bytes encoded in Base64.

## Health, scaling, and retention

- Liveness: `GET /api/health`.
- Readiness: `GET /api/ready` checks PostgreSQL and Redis.
- Metrics: `GET /metrics`, protected by `Authorization: Bearer $METRICS_TOKEN`.
- Use a load balancer with WebSocket upgrade support and sticky sessions if using Socket.IO long-polling fallback. WebSocket-only operation avoids polling affinity requirements.
- Configure `INCIDENT_RETENTION_DAYS` to match the approved data policy. The hourly BullMQ cleanup removes expired incidents, audit events, idempotency keys, and expired/revoked refresh tokens.
- Configure Sentry with `SENTRY_DSN`; tune sampling with `SENTRY_TRACES_SAMPLE_RATE`.
- Terminate TLS at the managed ingress. Set `TRUST_PROXY_HOPS` only to the exact number of trusted reverse-proxy hops in front of the API; do not enable blanket proxy trust. Restrict PostgreSQL, Redis, and `/metrics` to private networks.

## Migrating the old local SQLite file

Back up the old SQLite database. With `DATABASE_URL` set in `backend/.env`, run:

```powershell
npm --prefix backend run migrate:sqlite -- "backend/data/incidents.sqlite"
```

The import copies incident payloads, trusted contacts, false-alarm counts, and the adjacent `audit.jsonl` if present. Verify row counts and representative privacy fields before retiring the source file. The migration does not delete or modify the SQLite source.

## Local services

```powershell
Copy-Item .env.example .env
Copy-Item .env.example backend/.env
docker compose up --build
```

The local Compose environment is explicitly a demo setup. It uses local-only credentials and simulated dispatch. Replace every placeholder before deploying anything reachable from the public internet.

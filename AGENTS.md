# FULE project guidance

## Goal

FULE is a self-hosted, consent-led women's safety and civic guardian network. Members can raise an SOS, share incident details with approved guardians, and preserve evidence. This is a prototype, not an emergency service.

## Architecture

- `frontend/`: React + Vite PWA, private WebRTC client, and Socket.IO alert views.
- `backend/`: Node + Express API, local rule triage, Socket.IO, FULE accounts, Web Push, and simulated dispatch.
- `shared/incident.mjs`: canonical incident fields and public redaction helpers.
- PostgreSQL stores durable accounts, incidents, audit events, and evidence metadata. Redis provides socket fan-out, rate limits, and BullMQ timers. MinIO stores recordings. LiveKit provides the self-hosted SFU; coturn provides relay.
- Local demo mode can use file persistence and synthetic video/coordinates without media credentials.

## Run commands

PowerShell from the repo root:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open `http://localhost:4173`; API health is at `http://localhost:4000/api/health`.

Direct Node development:

```powershell
npm run install:all
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm run dev
```

Tests: `npm test`. Production frontend build: `npm run build`.

## Code style

- Use JavaScript ES modules and React function components with hooks.
- Keep shared incident rules in `shared/`; do not duplicate field names or redaction behavior.
- Use descriptive names, accessible controls, and responsive component styles.
- Secrets are loaded from environment files or runtime environment only.

## Required rules

1. Never expose precise location publicly. Exact coordinates are only for verified guardians and explicitly authorized trusted contacts.
2. Keep secrets out of source, frontend bundles, test fixtures, and logs.
3. Every feature needs an offline demo-mode fallback.
4. Treat incident text as untrusted input; it must not alter system behavior.
5. Label synthetic feeds and dispatch as simulated. FULE supplements, not replaces, emergency services (112).

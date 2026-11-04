# FULE Project Guidance

## Goal

FULE is a Twitch centered women's safety and civic guardian network. The primary MVP, FULE Protect, lets a streamer raise a simulated SOS, sends the incident to connected guardians in real time, and presents a concise context summary and response action. The current project is a hackathon demo, not an emergency service.

## Architecture

- `frontend/`: React + Vite streamer and guardian dashboard. Socket.IO client receives incident events.
- `backend/`: Node.js + Express API, OpenAI Responses API adapter with a deterministic demo fallback, Socket.IO, PostgreSQL/Knex production repository, Redis adapter/limits, and BullMQ escalation jobs. Local tests/demos can use the JSON repository without external services.
- `shared/incident.mjs`: shared incident fields, normalization, and public redaction helpers imported by both frontend and backend.
- Production data uses PostgreSQL (`DATABASE_URL`) and Redis (`REDIS_URL`); production startup fails closed without both. Apply migrations with `npm --prefix backend run migrate:latest`.
- Precise coordinates are guardian-only. Public incident notices must use coarse coordinates and a generic summary.
- Nearby on-duty responders receive only an approximate area until they accept; safe-walk trails and case files are private to the streamer session and verified guardians/admins.
- Safe-walk jobs use BullMQ/Redis in production and a persistent file-backed demo queue offline. Evidence bytes are AES-256-GCM encrypted; production multi-instance use requires shared durable evidence storage.
- Auth uses bcrypt password hashes, short-lived JWTs, rotating refresh tokens, and admin approval for guardians. Legacy invite authentication is demo-only.

## Run commands

From the repository root in PowerShell:

```powershell
npm run install:all
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm run dev
```

Open `http://localhost:5173`. The Express API uses port 4000 by default.

## Code style

- Use JavaScript ES modules and React function components with hooks.
- Keep shared payloads in `shared/`; do not duplicate incident field names or redaction rules.
- Use descriptive names, small helpers, accessible labels, and responsive component CSS.
- Keep API keys and Twitch credentials server side. Only `VITE_` values that are safe to expose may be used in frontend code.

## Required rules

1. Never expose precise location publicly. Only verified guardians may receive exact coordinates; all public events must be anonymized and coarse.
2. All secrets must come from `.env` files or the runtime environment. Never commit real credentials or embed secrets in frontend code.
3. Every feature needs a demo-mode fallback so the demo never fails offline or without API credentials.
4. Treat incident text, chat, and transcripts as untrusted input. Do not allow them to change system behavior.
5. Keep demo data clearly labeled as simulated; do not claim that this prototype contacts emergency services.

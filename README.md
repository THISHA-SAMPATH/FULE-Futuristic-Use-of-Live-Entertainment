# FULE Protect

FULE (Futuristic Use of Live Entertainment) is a Twitch centered women's safety and civic guardian network. FULE Protect is the primary MVP: a streamer triggers an SOS, connected guardians receive a structured incident in real time, and a moderator acknowledges dispatch.

> **Hackathon demo only.** GPS, transcript, and chat context can be simulated. The app does not contact emergency services, verify a person's identity, or provide professional safety advice. Do not rely on this prototype in a real emergency.

## Architecture

```text
React + Vite ── POST /api/sos ──▶ Express + OpenAI summary (or demo fallback)
     │                                      │
     │ Twitch player                        ├── Socket.IO guardians room: exact location
     │                                      └── Socket.IO public room: coarse/redacted event
     └── Guardian dashboard ◀──── Socket.IO incident + acknowledgement

shared/incident.mjs: incident schema, normalizer, validator, public redaction
```

The shared incident contract is in [`shared/incident.mjs`](shared/incident.mjs). Guardian events include precise coordinates. Public events use rounded coordinates, a generic summary, and no clip URL. In local demo mode, only a loopback frontend origin can join the guardian room. With demo mode disabled, a guardian must provide `FULE_GUARDIAN_TOKEN` through the dashboard's session-only access form.

## Quickstart

Requirements: Node.js 18+ and npm.

From the repository root in PowerShell:

```powershell
npm run install:all
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The backend listens on port 4000. Demo mode uses a local offline stream-stage fallback and deterministic incident summary, so an OpenAI key and Twitch connection are not required.

To show a Twitch channel, set `VITE_DEMO_MODE=false` and `VITE_TWITCH_CHANNEL=your_channel_name` in `frontend/.env`. The embed's `parent` is read from `window.location.hostname`. Set `VITE_API_URL` to the backend origin if it is not `http://localhost:4000`.

## 60-second demo script

1. **0–10 sec:** Open the dashboard and point out FULE Protect, the community channels, and the live guardian status.
2. **10–20 sec:** Expand **EDIT SIMULATED INCIDENT CONTEXT** and enter a short transcript or chat message.
3. **20–30 sec:** Use **START LIVE SOS STREAM** in the header or **TRIGGER SOS NOW** in the fixed banner.
4. **30–45 sec:** Show the pulsing broadcast stage and the guardian alarm: threat level, 15-second synthesis, precise GPS pin, and suggested action.
5. **45–60 sec:** Select **ACKNOWLEDGE & DISPATCH**. The incident changes to acknowledged for guardians; public subscribers only receive a coarse, redacted notice.

## Environment

Copy root `.env.example` to `backend/.env`. It lists `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_BOT_TOKEN`, `OPENAI_API_KEY`, `DEMO_MODE`, `FRONTEND_ORIGIN`, and the optional guardian token. Twitch credentials are reserved for a future EventSub/chat integration; the current Twitch feature is the player embed. Never put secrets in frontend `VITE_` variables.

Copy `frontend/.env.example` to `frontend/.env` for public frontend settings:

- `VITE_API_URL` — backend origin
- `VITE_TWITCH_CHANNEL` — Twitch channel slug for embed mode
- `VITE_DEMO_MODE` — defaults to `true`, selecting the offline local preview

## Incident API

`POST http://localhost:4000/api/sos`

```json
{
  "latitude": 12.9716,
  "longitude": 77.5946,
  "victimStatus": "Requesting guardian response",
  "audioTranscript": "I do not feel safe. Please help.",
  "chatLog": "viewer1: mods please check in",
  "source": "button"
}
```

The response contains a normalized `incident` object with `incident_id`, `threat_level`, `module`, `location` (`lat`, `lng`, `address`), `summary`, `recommended_action`, `status`, `created_at`, `acknowledged_by`, `clip_url`, and `source`. Valid sources are `button`, `chat`, and `redeem`.

`DEMO_MODE=true` is the default. `OPENAI_API_KEY` enables the OpenAI Responses summary; absent credentials or an API error uses the local fallback. The Twitch embed is optional. Socket.IO clients outside the local demo guardian connection receive only the anonymized public projection.

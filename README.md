# FULE Protect

FULE is a Twitch centered women's safety and civic guardian network. FULE Protect is the primary MVP: a streamer activates an SOS, guardians receive a structured incident, and the streamer has 10 seconds to cancel or mark a false alarm before dispatch readiness.

> **Hackathon demo only.** The app does not contact emergency services. “Contact emergency services (112)” is an escalation reminder for guardians. Do not rely on this prototype in a real emergency.

## Architecture

```text
React + Vite ── POST /api/sos ──▶ Express ──▶ OpenAI structured synthesis
     │                               │            └── deterministic demo/offline fallback
     │                               ├── verified guardians room: exact incident
     │                               └── public room: coarse, redacted incident
     └── streamer cancel token ── Socket.IO false_alarm / cancel_sos

shared/incident.mjs: schema, normalizer, validator, public redaction
backend/data/guardians.json: hashed invite-code registry (ignored by git)
backend/data/audit.jsonl: append-only state-change log (ignored by git)
```

Precise coordinates are only sent to verified guardian sockets and the initiating streamer. Public clients receive rounded coordinates, a generic summary, and no clip or stream URL. Guardians verify with an invite code; the API returns a short-lived session token. SOS cancellation credentials are random, returned only to the requesting streamer, and required to register the streamer socket.

## Quickstart

Requirements: Node.js 22+ and npm. From the repository root in PowerShell:

```powershell
npm run install:all
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The backend listens on port 4000. Demo mode uses a deterministic summary and an offline stream stage; external Twitch or OpenAI access is optional.

The demo guardian invite code in `.env.example` is for local demonstration only. Enter it in the dashboard's **Verify guardian invite** control. The code is hashed into `backend/data/guardians.json`; the raw value is never written there.

## Twitch integration setup

1. Create an application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Set its OAuth redirect URL to `http://localhost:4000/auth/twitch/callback` and use Authorization Code Grant.
2. Copy the Client ID and Client Secret into `backend/.env`. Set `DEMO_MODE=false`, `TWITCH_REDIRECT_URI=http://localhost:4000/auth/twitch/callback`, and keep `FRONTEND_ORIGIN=http://localhost:5173`. Never put Twitch secrets in frontend variables.
3. Keep `VITE_DEMO_MODE=true` while rehearsing the simulator. For live use, set it to `false` and sign in with **Connect Twitch**. FULE keeps the broadcaster ID, login, OAuth access/refresh tokens, scopes and expiry in backend memory only. Requested scopes are `user:read:chat`, `channel:read:redemptions`, and `clips:edit`.
4. Create a Channel Points reward named **Silent SOS** in the Twitch channel. Optionally set its reward ID in `TWITCH_SILENT_SOS_REWARD_ID`. The signed-in broadcaster's EventSub WebSocket listens for broadcaster-authored `!sos`/`!safe` and the matching redemption. Messages from other chatters are ignored.
5. Keep the FULE tab open and GPS simulator enabled to provide current simulated coordinates to the server. If an EventSub alert arrives without a location update, guardians see “Location unavailable”; FULE does not substitute a fabricated point. Twitch Create Clip is attempted after SOS and attached asynchronously when available. Offline/permission errors never delay the SOS.

Twitch OAuth/EventSub need working credentials and internet. Without them, **DEMO TRIGGERS** simulate `!sos`, a Silent SOS redemption, and `!safe` through the same incident pipeline. Incident cards embed the live Twitch channel only in the verified guardian dashboard. Precise coordinates, summaries, stream URLs and clip evidence are sent only to the authenticated `guardians` room; public updates omit them.

To connect the Twitch player, set `VITE_DEMO_MODE=false` and `VITE_TWITCH_CHANNEL=your_channel_name` in `frontend/.env`. The player `parent` is read from `window.location.hostname`. To enable OpenAI synthesis, set `OPENAI_API_KEY` in `backend/.env` and set `DEMO_MODE=false`. Without credentials or on API failure, a keyword-based deterministic fallback is used.

## 60-second demo

1. **0–10 sec:** Open the dashboard and verify a guardian with the demo invite code.
2. **10–20 sec:** Edit the simulated audio transcript to include an urgent phrase such as “someone is following me, please help”.
3. **20–30 sec:** Click **START LIVE SOS STREAM**. The app creates the incident, emits `sos_activated` to verified guardians, and opens the 10-second cancel window.
4. **30–45 sec:** Show the alarm summary and precise guardian map pin. The shared incident contains the threat, module, location, action, source, and status.
5. **45–60 sec:** Click **ACKNOWLEDGE & DISPATCH**, or before the grace timer ends, use **FALSE ALARM** / **CANCEL SOS** as the initiating streamer. The audit log records the state change.

## API and events

### `POST /api/sos`

```json
{
  "streamer_id": "streamer-demo-1",
  "location": { "lat": 12.9716, "lng": 77.5946 },
  "module_type": "FULE_PROTECT",
  "audio_transcript_snippet": "Someone is following me, please help.",
  "source": "button"
}
```

Valid module types: `FULE_PROTECT`, `FULE_ACCOUNT`, `FULE_RESPOND`. Valid sources: `button`, `chat`, `redeem`. The API allows at most three SOS activations per streamer in a rolling five-minute window. It returns `{ "incident": ..., "streamer_cancel_token": "..." }`; the cancel token is private to the requesting streamer.

### Guardian verification and incident history

- `POST /api/guardians/verify` with `{ "invite_code": "..." }` returns `{ guardian_id, access_token, expires_at }`.
- `GET /api/incidents` requires `Authorization: Bearer <access_token>` and returns full incidents.
- `acknowledge_incident` is accepted only from a verified guardian. The server sets `acknowledged_by` from the guardian registry identity, then sends `incident_acknowledged` to guardians.
- `false_alarm` and `cancel_sos` require a streamer socket registered with the incident's private cancellation token and are accepted only during the first 10 seconds.
- After the grace period, dispatch becomes ready. If no guardian acknowledges within 30 seconds of SOS activation (including the grace period), the server sets `escalated: true`, adds the emergency-services reminder, audits the transition, and emits `incident_escalated`.
- Public room events use the redacted incident projection; exact location is never sent to that room.

### Create a verified guardian invite

From `backend/`:

```powershell
npm run create:guardian -- guardian-123
```

The generated code is printed once; only its SHA-256 hash is stored in the registry. Keep the code private.

## Tests

```powershell
npm --prefix backend test
```

Tests cover SOS validation, per-streamer rate limits, demo fallback, and OpenAI-error fallback.

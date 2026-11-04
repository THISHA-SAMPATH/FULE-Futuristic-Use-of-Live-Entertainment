# FULE Protect

FULE is a Twitch centered women's safety and civic guardian network. FULE Protect is the primary MVP: a streamer activates an SOS, guardians receive a structured incident, and the streamer has 10 seconds to cancel or mark a false alarm before dispatch readiness.

> **Hackathon demo only.** The app does not contact emergency services. “Contact emergency services (112)” is an escalation reminder for guardians. Do not rely on this prototype in a real emergency.

## Architecture

```text
React + Vite ── POST /api/sos ──▶ Express ──▶ OpenAI structured synthesis
     │                               │            └── deterministic demo/offline fallback
     │                               ├── verified guardians room: immediate provisional alert, then AI update
     │                               └── public room: coarse, redacted incident
     └── streamer cancel token ── Socket.IO false_alarm / cancel_sos

shared/incident.mjs: schema, normalizer, validator, public redaction
backend/data/guardians.json: hashed invite-code registry (ignored by git)
backend/data/audit.jsonl: append-only state-change log (ignored by git)
```

Precise coordinates are only sent to verified guardian sockets and the initiating streamer. Before OpenAI synthesis, the backend rounds latitude and longitude to two decimal places. Public clients receive rounded coordinates, a generic summary, and no clip or stream URL. Guardians verify with an invite code; the API returns a short-lived session token. SOS cancellation credentials are random, returned only to the requesting streamer, and required to register the streamer socket.

## Quickstart

Requirements: Node.js 22+ and npm. From the repository root in PowerShell:

```powershell
npm run install:all
Copy-Item .env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The backend listens on port 4000. Demo mode uses a deterministic summary and an offline stream stage; external Twitch or OpenAI access is optional.

For the seeded dashboard, set `DEMO_MODE=true` in `backend/.env` and `VITE_DEMO_MODE=true` in `frontend/.env`. The START LIVE SOS and floating SOS buttons work without Twitch login or geolocation, using a synthetic `Demo Streamer` and synthetic coordinates. The **Demo Triggers** panel also sends simulated Button SOS, `!sos` chat, and Silent SOS redeem sources, with an editable transcript and scenario selector. All are clearly labeled simulated. Set both values to `false` to require Twitch login and browser geolocation and to see production empty/loading/error states.

The development server uses strict ports so it reports conflicts instead of silently moving the frontend to a port rejected by the backend origin policy. If a previous FULE run is still listening, inspect and stop only the stale FULE PIDs in PowerShell:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4000,5173 | Select-Object LocalPort,OwningProcess
Stop-Process -Id <PID> -Force
```

The demo guardian invite code in `.env.example` is for local demonstration only. Enter it in the dashboard's **Verify guardian invite** control. The code is hashed into `backend/data/guardians.json`; the raw value is never written there.

## Twitch setup

1. In the [Twitch Developer Console](https://dev.twitch.tv/console/apps), create a **Confidential** application. Set OAuth Redirect URL to `http://localhost:4000/auth/twitch/callback`.
2. Put `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI=http://localhost:4000/auth/twitch/callback` in `backend/.env`. Keep the secret out of `frontend/.env` and all `VITE_` variables. Keep `FRONTEND_ORIGIN=http://localhost:5173` for local runs.
3. Set `DEMO_MODE=false` in `backend/.env` and `VITE_DEMO_MODE=false` in `frontend/.env`, then restart `npm run dev`. Click **Connect Twitch** and approve the requested permissions. OAuth uses a single-use, ten-minute state value bound to an HttpOnly, SameSite=Lax browser cookie; access and refresh tokens stay in backend memory. The header then shows the authorized channel login and profile image.
4. The authorization asks for `user:read:chat`, `channel:read:redemptions`, and `clips:edit`. It also asks for `channel:manage:redemptions` so FULE can create the **Silent SOS** reward if it is missing. Twitch requires that additional permission for reward creation; existing rewards can be read with `channel:read:redemptions`. Channel Points rewards require a Twitch Affiliate or Partner channel. Set `TWITCH_SILENT_SOS_COST` if the created reward should cost more than the default 1 point. FULE reuses a reward named **Silent SOS** and subscribes only to that reward when its ID is known.
5. Keep the Twitch account authorized and the FULE backend running. EventSub subscribes to broadcaster-authored chat and channel-point redemptions. Only `!sos` and `!safe` sent by the channel owner are accepted; duplicate message IDs and repeated commands are suppressed. A `session_reconnect` handoff retains Twitch subscriptions; an unexpected close reconnects with exponential backoff and resubscribes. Connection transitions are written to `backend/data/audit.jsonl`.
6. On SOS, FULE requests a Twitch clip and polls for its published URL for up to 10 seconds. If the channel is offline or the API does not produce a clip in time, the incident proceeds without clip evidence. The channel player is rendered only in the verified guardian view while an incident is active.
7. For Twitch embeds, each served hostname must be included as a `parent` parameter. FULE reads the current host from `window.location.hostname`, so local `localhost` and a LAN hostname resolve to the host used to open the app. Production embedding requires HTTPS and the production hostname.

Twitch OAuth/EventSub need working credentials and internet. Without them, **Demo Triggers** simulate the button, `!sos`, and Silent SOS redemption source through the same incident pipeline. The synthetic demo coordinates and incidents are not real requests for help. Precise coordinates, detailed summaries, stream URLs and clip evidence are sent only to the authenticated `guardians` room; public updates omit them.

To connect the Twitch player, set `VITE_DEMO_MODE=false` and `VITE_TWITCH_CHANNEL=your_channel_name` in `frontend/.env`. The player `parent` is read from `window.location.hostname`. To enable OpenAI synthesis, set `OPENAI_API_KEY` in `backend/.env` and set `DEMO_MODE=false`. Without credentials or on API failure, a keyword-based deterministic fallback is used.

## 60-second demo

1. **0–10 sec:** Open the dashboard and verify a guardian with the demo invite code from `.env.example`. Confirm the **DEMO MODE** badge.
2. **10–20 sec:** In **Demo Triggers**, choose **Walking alone at night** and review/edit its clearly simulated transcript.
3. **20–30 sec:** Click **Button SOS** (or try `!sos chat` / **Silent SOS redeem**). The request uses the same `/api/sos` pipeline; the incident immediately appears in the verified guardian panel and public feed remains anonymized.
4. **30–45 sec:** Show the 10-second cancel toast, optional loud alarm toggle, and guardian-only exact map pin. Use **CANCEL SOS** during the grace window to reset before another source demo.
5. **45–60 sec:** Trigger again and click **ACKNOWLEDGE & DISPATCH** as the verified guardian. The backend audits the state change. These simulated flows do not contact emergency services.

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
- A deterministic provisional incident is broadcast to guardians immediately; AI synthesis updates it later through `incident_updated`. OpenAI receives only two-decimal coordinates, has a hard eight-second deadline including retry, and falls back deterministically on missing credentials or failure. Blank-transcript button and redeem SOS defaults to `CRITICAL`.
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
npm --prefix frontend test
```

Backend tests cover route-level SOS creation for all supported modules, OAuth redirect/state-cookie binding, mocked code exchange/profile lookup/token refresh/reward setup, broadcaster-only `!sos`/`!safe`, duplicate suppression, EventSub reconnect/backoff, clip polling/offline fallback, public and guardian data separation, acknowledge/cancel/false-alarm/escalation, and AI fallback/privacy paths. Frontend tests cover demo SOS submission without login or geolocation plus the guardian-only active-incident stream access rule and Twitch `parent` URL.

# FULE Protect

FULE (Futuristic Use of Live Entertainment) Protect is a Codex x TwitchCon hackathon MVP for community-powered safety during Twitch streams. A streamer can send a simulated SOS with location and stream context; connected guardians receive the alert over Socket.IO, review a structured 15-second incident summary, open the map pin, and acknowledge dispatch. The UI embeds a Twitch player and lets you edit simulated transcript and chat context.

> **Demo only:** GPS, transcript, and chat are simulated. This local app does not contact emergency services, verify responders, encrypt the stream, preserve evidence, or provide professional safety advice. Do not rely on it in a real emergency. If `OPENAI_API_KEY` is configured, transcript/chat text is sent to the OpenAI API to produce a summary; otherwise the app uses a local fallback.

## Architecture

```text
┌──────────────────────────┐       POST /api/sos        ┌──────────────────────────┐
│ React + Vite streamer UI │ ─────────────────────────▶ │ Express API              │
│ Twitch embed · SOS · GPS │                            │ validate · summarize     │
└────────────┬─────────────┘                            └────────────┬─────────────┘
             │                                                       │
             ▼                                         Socket.IO sos:alert
       Twitch player                                               ▼
                                                   ┌──────────────────────────┐
                                                   │ Guardian Dashboard       │
                                                   │ summary · map · dispatch │
                                                   └──────────────────────────┘
```

The backend uses the OpenAI Responses API with a strict JSON schema when `OPENAI_API_KEY` is set. The model summarizes recent transcript and chat evidence; the server supplies coordinates and enforces the SOS incident type and dispatch action. A deterministic local fallback keeps the MVP runnable without credentials. `OPENAI_MODEL` selects the model.

## Architecture review: high impact next steps

1. **Twitch EventSub chat context.** Subscribe to `channel.chat.message` with a broadcaster-authorized Twitch user token, buffer a rolling 15-second window, and pass that window to the incident summarizer. The current UI accepts pasted demo chat; EventSub would make that context live. See [Twitch EventSub](https://dev.twitch.tv/docs/eventsub/) and [chat authentication](https://dev.twitch.tv/docs/chat/authenticating).
2. **Verified, tiered access.** Add Twitch OAuth, a trusted-contact allowlist, short-lived incident-scoped access, and role-based Socket.IO rooms. Guardians would receive precise location and stream access; public viewers would receive delayed, coarse, anonymized incident notices. This demo has no identity verification or tiered access control.
3. **Consent-driven OBS response and audit trail.** Offer an opt-in OBS WebSocket action (such as switching to a privacy scene) plus a timestamped incident event log. Require explicit consent and test recovery behavior before enabling scene changes; do not claim evidence integrity until storage and key management are designed.

## Requirements

- Node.js 18 or newer
- npm
- Internet access for package installation, the Twitch player, and Google Fonts

## Quickstart

In PowerShell, from the repository root, install all dependencies:

```powershell
npm run install:all
```

Start the API and Vite development server together:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API listens at [http://localhost:4000](http://localhost:4000). Use the SOS button to send an alert. Expand **EDIT DEMO INCIDENT CONTEXT** to edit simulated transcript/chat. A second browser tab can monitor alerts over Socket.IO.

To use OpenAI summaries, create `backend/.env`:

```env
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
```

Keep this key on the backend; do not put it in a `VITE_` frontend variable. Without a key, the local fallback is used.

### Run in separate terminals

```powershell
# Terminal 1 — API
cd backend
npm install
npm run dev
```

```powershell
# Terminal 2 — web app
cd frontend
npm install
npm run dev
```

## Try the API

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4000/api/sos -ContentType 'application/json' -Body '{"latitude":12.9716,"longitude":77.5946,"victimStatus":"Requesting guardian response","liveStreamUrl":"https://www.twitch.tv/twitch","audioTranscript":"I do not feel safe. Please help.","chatLog":"viewer1: mods please check in"}'
```

The API responds with `{ "ok": true, "alert": { ... } }` and broadcasts the alert as `sos:alert`. `incidentSummary` contains:

```json
{
  "threat_level": "CRITICAL",
  "incident_type": "Women's Safety SOS",
  "location_coords": "12.9716, 77.5946",
  "summary": "Immediate distress trigger registered near public transit zone.",
  "recommended_action": "DISPATCH_COMMUNITY_MODS"
}
```

Guardians emit `incident:acknowledge` with the incident ID; the server broadcasts `incident:acknowledged`. The example summary above illustrates the response shape; model text depends on the supplied data.

## Configuration

Backend environment variables:

- `PORT` — API port (default `4000`)
- `FRONTEND_ORIGIN` — allowed frontend origin (default `http://localhost:5173`)
- `OPENAI_API_KEY` — optional server-only API key; no key selects the local fallback
- `OPENAI_MODEL` — optional model name (default `gpt-4.1-mini`)

Frontend variable: `VITE_API_URL` — backend origin (default `http://localhost:4000`).

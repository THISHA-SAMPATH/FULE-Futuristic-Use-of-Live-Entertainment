# FULE Protect

FULE (Futuristic Use of Live Entertainment) Protect is a hackathon MVP for community-powered safety during live streams. A streamer can send a simulated SOS with location and stream context; connected guardians receive the alert immediately, review a short incident summary, open the map pin, and acknowledge dispatch.

> **Demo only:** This prototype does not contact emergency services, verify a person's identity or location, or provide professional safety advice. Coordinates and transcript inputs are simulated. Do not rely on it in a real emergency.

## Architecture

```text
┌──────────────────────────┐       POST /api/sos        ┌──────────────────────────┐
│ React + Vite streamer UI │ ─────────────────────────▶ │ Express API              │
│ SOS · GPS simulator      │                            │ validate · summarize     │
└────────────┬─────────────┘                            └────────────┬─────────────┘
             │                                                       │
             │ Twitch embed                             Socket.IO sos:alert
             ▼                                                       ▼
       Twitch player                                ┌──────────────────────────┐
                                                   │ Guardian Dashboard       │
                                                   │ incident · map · dispatch│
                                                   └──────────────────────────┘
```

The backend includes a deterministic mock for the OpenAI transcript summarization step. It returns a structured summary with `threat_level`, `summary`, and `recommended_action`; replace `createIncidentSummary` in `backend/server.js` with a secured model API call when ready. The current mock marks incoming SOS events `CRITICAL` and recommends `DISPATCH_MODS`.

## Requirements

- Node.js 18 or newer
- npm
- Internet access for the Twitch player and Google Fonts

## Quickstart

From the repository root, install all dependencies:

```bash
npm run install:all
```

Start the API and Vite development server together:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API listens at [http://localhost:4000](http://localhost:4000). Use the prominent SOS button to send a simulated alert to the dashboard. Open a second browser tab to see the same alert arrive over Socket.IO.

You can also run the servers in separate terminals:

```bash
# Terminal 1 — API
cd backend
npm install
npm run dev
```

```bash
# Terminal 2 — web app
cd frontend
npm install
npm run dev
```

## API

`POST http://localhost:4000/api/sos`

```json
{
  "latitude": 37.7694,
  "longitude": -122.4862,
  "victimStatus": "Requesting guardian response",
  "liveStreamUrl": "https://www.twitch.tv/example",
  "transcript": "I do not feel safe. Please help."
}
```

The API responds with `{ "ok": true, "alert": { ... } }` and broadcasts the alert as `sos:alert`. Guardians can emit `incident:acknowledge` with the incident ID; the server broadcasts `incident:acknowledged`.

## Configuration

Optional backend environment variables:

- `PORT` — API port (default `4000`)
- `FRONTEND_ORIGIN` — allowed frontend origin (default `http://localhost:5173`)

Optional frontend variable: `VITE_API_URL` — backend origin (default `http://localhost:4000`).

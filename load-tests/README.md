# FULE load test

`fule.js` opens 1,000 concurrent Engine.IO/Socket.IO WebSocket clients over a 100-second ramp/hold/drain profile. Fifty connected VUs each submit one synthetic SOS per second (50 requests/s) through the demo-only load-test token path. Each submitting client measures from beginning its SOS POST until the matching anonymized `incident:public` event arrives on that WebSocket.

Run against the local Compose stack (PowerShell):

```powershell
$env:DEMO_MODE = 'true'
$env:FULE_LOAD_TEST_TOKEN = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:FULE_SOS_IP_LIMIT = '5000'
$env:FULE_API_IP_LIMIT = '5000'
docker compose -p fule up --build -d
$backendContainer = docker compose -p fule ps -q backend
docker run --rm --network fule_default `
  -e BASE_URL=http://backend:4000 `
  -e WS_URL=ws://backend:4000 `
  -e FRONTEND_ORIGIN=http://localhost:4173 `
  -e FULE_LOAD_TEST_TOKEN=$env:FULE_LOAD_TEST_TOKEN `
  -v "${PWD}/load-tests:/work" -w /work grafana/k6:latest run fule.js
docker stats $backendContainer --no-stream
docker compose -p fule down
```

For a no-Docker single-process baseline, run `npm run load:test:baseline`. This is useful as a smoke/load profile only; it uses an in-memory repository and cannot validate Redis, PostgreSQL, or horizontal scaling. It writes measured results to `load-tests/results/local-baseline.json`.

The k6 output reports `fule_alert_delivery_latency_ms` percentiles, `fule_sos_request_errors`, and alert delivery counts. Save stdout and the generated `results/latest.json` with the Docker resource snapshot for a reproducible report. The demo load-test token is accepted only when `DEMO_MODE=true`; never set it in a real deployment.

# Self-host deployment guide

FULE is intended to run on infrastructure you control. The local Compose definition is the reference stack; it starts the PWA, API, PostgreSQL, Redis, MinIO, LiveKit, Egress, and coturn.

## Host preparation

1. Install Docker Engine and Compose plugin on a supported Linux host.
2. Clone the repository, copy `.env.example` to `.env`, and generate unique values for every secret.
3. Set `FRONTEND_ORIGIN` to the exact HTTPS origin served by your reverse proxy. Keep the database, Redis, object console, SFU control port, and coturn admin surface off the public internet.
4. Configure TLS at the reverse proxy. Publish only the frontend/API plus the required WebRTC signaling and media ports.
5. Set `TURN_EXTERNAL_IP` to the public address and `LIVEKIT_TURN_URL` to the corresponding reachable relay endpoint. Open the LiveKit UDP media range and coturn relay range in the host firewall.
6. Set durable Docker volumes, backups, incident retention, and recording retention before onboarding real users.
7. Start with `docker compose up --build`; the backend applies migrations before it accepts traffic. Check `/api/health`, `/api/ready`, and protected `/metrics`.
8. Create an administrator account with `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `DATABASE_URL` set in the backend environment, then run `npm --prefix backend run create:admin` from the project checkout.
9. Generate VAPID keys locally and configure them on the backend. Confirm browser permissions and delivery in the target browsers.

## Operational boundaries

Demo mode uses generated video, synthetic coordinates, and an internal dispatch simulation. Disable demo mode for account-based deployment. The dispatch console never contacts an authority. A user can choose the direct `tel:112` link on their own device.

No public URL, performance number, concurrency limit, or emergency-response guarantee is implied by this repository. Benchmark the exact host/network configuration, inspect logs/metrics, and validate backup restore before production use.

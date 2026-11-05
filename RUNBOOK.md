# FULE operations runbook

## Alerts are slow

1. Check `GET /api/health` for degraded modes and `GET /api/ready` for PostgreSQL/Redis readiness.
2. Inspect structured API logs by `request_id`; compare `sos_activated` delivery latency with `fule_http_request_duration_seconds`.
3. Check Prometheus `fule_alert_delivery_latency_seconds`, active socket count, and escalation queue depth.
4. The metrics endpoint is `GET /metrics`; use the configured bearer token if `METRICS_TOKEN` is set.
5. Check Redis connectivity and BullMQ queue age. If Redis is unavailable, the process reports degraded single-instance behavior and uses the local fallback path.
6. Confirm guardian sockets are connected and role-approved. Inspect `GUARDIAN_APPROVED` and incident audit entries.

## SOS requests failing

1. Reproduce with one unique `Idempotency-Key`; inspect the response status and `x-request-id`.
2. Check JSON validation errors, per-IP/per-user rate-limit `Retry-After`, and request-size limits.
3. Check `/api/health` and `/api/ready`, then inspect PostgreSQL/Redis logs and connection availability.
4. Confirm `DEMO_MODE` and account identity match the selected flow. Production requests need an authenticated FULE account and location permission.
5. Review local rule-triage output and audit transition events. Guardian alert delivery should not wait for a separate triage provider.

## Evidence or media failures

Check LiveKit signaling, coturn reachability, Egress logs, MinIO health, and the evidence-chain verification result. A media failure must not prevent guardian acknowledgement. Never disable access checks to make a stream visible.

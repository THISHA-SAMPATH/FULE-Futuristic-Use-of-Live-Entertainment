# FULE backend runbook

## Alerts are slow

1. Check `GET /api/health` for `dependencies`, `degraded_modes`, and `alerts_available`. Guardian delivery is emitted before AI synthesis; `alerts_available` should remain `true` while AI, Twitch, or dispatch are degraded.
2. Check `GET /metrics` for `fule_alert_delivery_latency_seconds` and `fule_http_request_duration_seconds` bucket/count/sum series. Compare SOS route request latency with alert delivery latency.
3. Check `fule_active_sockets` and `fule_queue_depth{queue="fule-escalations"}`. A rising queue with slow delivery points to worker or Redis pressure; a high socket count with low queue depth points to fan-out pressure.
4. Search JSON logs for `slow_request`, `rate_limit_backend_failed`, `incident_synthesis_failed`, and `durable_escalation_queue_unavailable_using_local_timer`. Correlate using `request_id`; dependency failures carry `taxonomy: "dependency"`.
5. Verify Redis with `redis-cli -u "$REDIS_URL" PING`, PostgreSQL with `pg_isready -d "$DATABASE_URL"`, and inspect worker health before restarting any instance.

## SOS requests failing

1. Capture the response status, body, `Retry-After`, and `X-Request-Id`. A 400 indicates schema/Idempotency-Key validation; 401/403 indicates identity or role failure; 409 indicates an active/acknowledged transition; 429 includes a retry delay; 503 indicates an unavailable shared rate limiter or a still-processing idempotency key.
2. Query `GET /api/health`; confirm database and Redis status. `/api/ready` must return 200 before routing production traffic to an instance.
3. Search structured logs by `request_id`. `taxonomy` distinguishes `client`, `dependency`, and `internal` failures. Check `fule_http_requests_total` by route/status and `fule_http_request_duration_seconds` for saturation or timeouts.
4. Confirm `Idempotency-Key` is present and stable across client retries. Retrying with a new key creates a new request and can be rejected by the per-streamer SOS limit.
5. If storage is degraded, new alerts can be delivered from volatile memory, but that incident is not durable until storage recovers. Preserve the request ID and restore PostgreSQL before relying on history or escalation recovery.

## CI deployment

The GitHub Actions workflow runs backend and frontend checks on pushes and pull requests. A push to `main` invokes the Render backend deploy hook only when the repository secret `RENDER_DEPLOY_HOOK_URL` is configured. Configure frontend hosting separately in the hosting provider; this workflow does not claim a frontend deployment.

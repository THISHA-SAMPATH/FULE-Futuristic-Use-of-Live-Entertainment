# ADR-004: Readiness, observability, and retention

- Status: Accepted
- Date: 2026-11-04

## Decision

Expose liveness/readiness and Prometheus metrics, emit structured request logs with request IDs, support Sentry through configuration, shut down workers and database connections gracefully, and delete incident/audit data after a configurable retention period.

## Rationale

Operators need to distinguish process health from dependency readiness, correlate errors, observe fan-out and backlog, and enforce a bounded retention policy.

## Consequences

Metrics and Sentry endpoints/settings must be secured and reviewed for privacy. Retention defaults to 90 days but must be set to the approved policy for each deployment. Performance numbers are published only after measured load runs.

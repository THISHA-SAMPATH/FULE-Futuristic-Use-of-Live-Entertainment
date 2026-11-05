# ADR-004: Self-hosted operations and retention

## Decision

Use PostgreSQL for durable records, Redis for shared coordination and jobs, JSON logs and Prometheus metrics for operations, and configurable automated retention. Run the app and supporting services in Compose for local setup.

## Rationale

Self-hosting makes incident data handling and runtime dependencies inspectable and keeps the demo usable without external API credentials.

## Consequences

Operators own patching, backups, secrets, monitoring, capacity, and deletion policy. Performance reports must contain measured results only. Keep health and metrics endpoints private or protected.

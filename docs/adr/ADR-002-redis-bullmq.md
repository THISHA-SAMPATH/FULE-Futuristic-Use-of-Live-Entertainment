# ADR-002: Redis coordination and BullMQ jobs

- Status: Accepted
- Date: 2026-11-04

## Decision

Use Redis for Socket.IO adapter fan-out and shared rate-limit counters. Use BullMQ delayed jobs with per-incident IDs for contact/dispatch escalation and scheduled retention cleanup.

## Rationale

Instance-local Socket.IO rooms, rate counters, and `setTimeout` callbacks do not survive restarts or coordinate multiple workers. Redis-backed primitives provide shared fan-out, durable delay scheduling, and retryable workers.

## Consequences

Production requires highly available Redis and alerting for worker backlog. Jobs must remain idempotent because queues provide at-least-once delivery under worker failures. API handlers still verify current incident state before processing.

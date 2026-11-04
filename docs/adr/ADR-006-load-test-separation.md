# ADR-006: Separate production k6 load profile from local baseline

- Status: Accepted
- Date: 2026-11-04

## Decision

Maintain a k6 script for the requested 1,000 socket / 50 SOS-per-second profile and a Node-based baseline runner that works without Docker. Clearly label baseline results as single-process demo measurements and never present them as production capacity.

## Rationale

Production measurements require PostgreSQL, Redis, load-generation resources, and backend resource collection. A local baseline still reveals obvious event-loop/fan-out failures when those services are unavailable, provided its limitations are explicit.

## Consequences

The local run does not validate multi-instance behavior. The final production capacity claim remains gated on a complete k6 run against the Compose or deployed PostgreSQL/Redis stack.

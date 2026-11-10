# ADR-005: Encrypted Twitch credentials and EventSub ownership

- Status: Accepted
- Date: 2026-11-04

## Decision

Persist Twitch OAuth credentials encrypted with AES-256-GCM in PostgreSQL, sign short-lived Twitch session cookies, keep OAuth state one-time and Redis-backed, and use a renewable Redis lease so only one FULE instance owns each broadcaster's EventSub WebSocket.

## Rationale

Process-local tokens and OAuth state break behind a load balancer and cannot survive instance restarts. Duplicated EventSub sockets can double-trigger SOS events. Encrypted persistent credentials plus a single owner allow API calls to any instance while preserving one event consumer.

## Consequences

Production Twitch OAuth requires `TWITCH_TOKEN_ENCRYPTION_KEY` and Redis. Losing the encryption key makes stored Twitch tokens unreadable; rotate through a reauthorization/migration procedure. Lease failure closes the socket and retries ownership acquisition.

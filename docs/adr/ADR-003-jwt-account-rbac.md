# ADR-003: Account auth, short-lived JWTs, and guardian approval

- Status: Accepted
- Date: 2026-11-04

## Decision

Use email/password accounts with bcrypt hashes, 10-minute signed JWT access tokens, rotating opaque refresh tokens stored as hashes, and roles `user`, `guardian_pending`, `guardian`, and `admin`. Admins grant guardian status. Keep old invite verification limited to local demo mode.

## Rationale

Process-local invite sessions do not survive restarts and cannot establish administrative approval or support shared authorization across API instances.

## Consequences

Production must provision a strong JWT secret and an initial admin account, protect refresh tokens, rate-limit auth endpoints, and define account recovery before public rollout. Twitch OAuth remains the separate streamer/Twitch API authorization channel.

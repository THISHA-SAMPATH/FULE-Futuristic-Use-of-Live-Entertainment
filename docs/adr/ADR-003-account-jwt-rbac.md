# ADR-003: FULE accounts and role-based access

## Decision

Accounts use email and password with bcrypt hashes. Short-lived signed access tokens and rotating refresh tokens authenticate requests. Roles are user, guardian, and admin; administrators approve guardian requests.

## Rationale

FULE needs a single identity model for incident ownership, guardian permissions, and audit attribution. Role approval is explicit and reviewable.

## Consequences

Deployments must keep JWT signing material private, provision an initial administrator, rate-limit authentication routes, and provide account recovery before public use. Refresh tokens are stored hashed and rotated on use.

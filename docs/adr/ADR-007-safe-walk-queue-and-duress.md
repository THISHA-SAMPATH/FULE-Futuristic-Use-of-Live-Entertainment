# ADR-007: Safe-walk check-ins and duress PIN

## Decision

Persist safe-walk state in PostgreSQL and schedule check-in/60-second timeout jobs through BullMQ on Redis. Use stable job IDs and sequence numbers; workers reload state and no-op once a check-in, cancellation, or prior SOS changed its state. Offline demo mode uses an atomic file-backed queue. Store HMAC hashes of separate safe and duress PINs; the duress PIN returns the normal check-in response while invoking the existing SOS pipeline.

## Consequences

Jobs recover after worker restarts and concurrent/retried jobs are guarded by durable status checks. Demo queue is single-process and not an HA substitute. Location history is precise and is only returned by the session-token-protected safe-walk API or a verified case file. Browser location and push-notification prompts require explicit permission.

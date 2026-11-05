# ADR-009: Tamper-evident evidence

## Decision

Store bounded evidence chunks in encrypted local storage or the configured object store. Hash each item with SHA-256 and append metadata to a per-incident hash chain. Case files include a chain verification result.

## Rationale

The integrity chain makes accidental changes detectable without representing that FULE proves the truth of recorded content.

## Consequences

Operators must secure the encryption key and object store, define retention, and ensure each deployed instance can reach the same durable evidence storage.

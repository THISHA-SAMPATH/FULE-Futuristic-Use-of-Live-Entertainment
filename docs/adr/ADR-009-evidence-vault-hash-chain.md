# ADR-009: Evidence vault and append-only SHA-256 chain

## Decision

Upload bounded 10-second browser-recorded audio/video chunks after permission. Hash the raw bytes with SHA-256, store bytes through an evidence storage adapter, and append metadata to a per-incident chain inside a PostgreSQL transaction that locks the chain head. A case-file export includes the incident, response timeline, Twitch clip links, safe-walk location trail, evidence hashes/download paths, chain verification, and an independent hash check of stored chunk bytes.

## Consequences

The local adapter is a filesystem implementation and supports one host only. Production horizontal scaling requires a shared, encrypted object store and key management before deployment. Chunks are size and MIME-type limited and protected by streamer session capability on upload; downloads and case files require verified guardian/admin access. Incident retention deletes chunk metadata and files together.

# Performance notes

## Historical local measurements

The repository includes prior single-process demo measurements in `load-tests/results/`. They used one development Node process and did not include the PostgreSQL/Redis/MinIO/LiveKit Compose stack. They are historical and must not be represented as capacity measurements for the current self-hosted deployment.

One captured baseline reports 1,000 connected Socket.IO clients and 657 SOS requests initiated during a 15-second target window. It recorded 409 HTTP 201 responses, 248 network/timeout errors (37.75%), and public alert delivery latency p50/p95/p99 of 12,861/18,255/18,315 ms. The process used 256.85 MB peak memory. PostgreSQL, Redis, and object-store resource use were not measured.

## Tradeoffs and limits

- The in-app guardian alert is emitted before the asynchronous local triage result update. This prioritizes initial delivery over waiting for a final summary.
- Rule triage is fast and inspectable but cannot reliably understand nuance, sarcasm, or context beyond its configured patterns and risk input.
- The historical in-memory run showed high load errors and latency. No 1,000-client or 50-SOS-per-second production claim is made for the current Compose architecture.
- Re-run the load profile against the exact deployment, record resource usage and service versions, then replace this section with comparable measured results.

# Performance notes

## Local measurements

The repository's single-process demo load harness was run before and after the reliability changes. Both recorded runs requested 1,000 Socket.IO clients, targeted 50 SOS requests/second for 15 seconds, and used the in-memory demo repository on a 4-logical-CPU host. The result files are [`pre-hardening.json`](load-tests/results/pre-hardening.json) and [`local-baseline.json`](load-tests/results/local-baseline.json).

| Measurement | Before | After |
| --- | ---: | ---: |
| Connected sockets | 1,000 | 1,000 |
| SOS requests attempted | 657 | 466 |
| Accepted incidents | 409 | 321 |
| Achieved request rate | 43.80/s | 31.07/s |
| Request error rate | 0.3775 | 0.3112 |
| Alert delivery p50 | 12,861 ms | 6,659 ms |
| Alert delivery p95 | 18,255 ms | 19,170 ms |
| Alert delivery p99 | 18,315 ms | 19,562 ms |
| Backend RSS peak | 256.85 MB | 225.26 MB |
| Backend CPU user / system | 9.69 / 9.52 s | 10.63 / 11.52 s |

These are two individual local runs, not a controlled statistical comparison. The after run had lower median delivery latency and fewer failed HTTP attempts, but lower throughput and higher tail latency. Do not use these local in-memory measurements as a production capacity claim.

## Tradeoffs and limits

- FULE broadcasts a deterministic provisional alert before asynchronous AI synthesis. This favors getting an initial alert to guardians quickly; a later `incident_updated` event improves the summary when AI is available.
- AI, Twitch, and webhook calls use bounded retries, jitter, and circuit breakers. Retries reduce transient dependency errors but add delay to those dependency operations; guardian alert delivery does not wait for AI.
- The local run did not include PostgreSQL, Redis, multiple API instances, TLS, Twitch, or a dispatch provider. It did not measure database or Redis resources.
- The repository includes a k6 1,000-socket/50-SOS-per-second profile in [`load-tests/fule.js`](load-tests/fule.js). This environment had Docker CLI installed but the Docker daemon was unavailable, so a k6 run could not be executed here. The checked-in numeric results above come only from the Node-based local harness.

# Load test report

## Status

**Production stack test not run.** The included Node baseline was run against the current checkout with 1,000 Socket.IO clients and a 15-second target window at 50 SOS/s. It used one development Node process and an in-memory repository, without PostgreSQL, Redis, or multiple instances. These figures are exact for that run and are not production capacity measurements. The k6 executable is not installed, and Docker cannot connect to its daemon (`npipe:////./pipe/docker_engine` is unavailable), so the Compose-backed k6 run could not be performed.

## Local baseline results

| Measurement | Result |
|---|---:|
| Concurrent Socket.IO clients | 1,000 connected |
| SOS target / achieved rate | 50/s target; 43.80/s scheduled during the 15.00s load window |
| Requests | 657 initiated; 409 HTTP 201 responses; 248 network/timeout errors |
| Alert delivery latency p50 / p95 / p99 | 12,861 ms / 18,255 ms / 18,315 ms (409 correlated public Socket.IO alerts) |
| Request error rate | 37.75% (248 errors / 657 initiated requests) |
| Backend process memory | 256.85 MB peak; 253.75 MB final across 18 one-second Prometheus samples |
| Backend process CPU time | 9.69 s user + 9.52 s system; host reported 4 logical CPUs |
| PostgreSQL / Redis resource use | Not measured; services could not start without Docker daemon |

The earlier baseline report has been replaced with these current-checkout measurements at `load-tests/results/local-baseline.json`.

## Bottlenecks and next fixes

The single-process baseline missed the target rate and had high request errors and alert latency. It establishes a capacity problem, but does not isolate its cause; event-loop saturation, synchronous fan-out pressure, and per-request work are candidates to profile. Next, run the supplied k6 scenario against Compose, record event-loop delay and Socket.IO write-buffer pressure, and compare one versus multiple API instances with Redis fan-out. Then inspect PostgreSQL query/pool latency and BullMQ queue delay. Do not claim the scaling architecture meets the load target until the PostgreSQL/Redis-backed run produces better measured latency and error rates.

## Reproduction

See [load-tests/README.md](load-tests/README.md). Record the k6 output and Docker resource snapshot with date, image revision, host CPU/memory, PostgreSQL/Redis versions, pool size, and scenario profile before updating this report.

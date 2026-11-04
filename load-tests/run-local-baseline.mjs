import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(fileURLToPath(new URL('../frontend/package.json', import.meta.url)));
const { io } = require('socket.io-client');
const port = Number(process.env.FULE_LOAD_PORT) || 4312;
const origin = `http://127.0.0.1:${port}`;
const frontendOrigin = `http://localhost:4173`;
const clientCount = Number(process.env.LOAD_SOCKET_CLIENTS) || 1000;
const eventRate = Number(process.env.LOAD_SOS_PER_SECOND) || 50;
const durationSeconds = Number(process.env.LOAD_DURATION_SECONDS) || 15;
const dataDirectory = resolve(`load-tests/results/tmp-${process.pid}`);
const backend = spawn(process.execPath, ['server.js'], {
  cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
  env: {
    ...process.env, NODE_ENV: 'development', PORT: String(port), FRONTEND_ORIGIN: frontendOrigin,
    DEMO_MODE: 'true', DATABASE_URL: '', REDIS_URL: '', FULE_STORAGE: 'memory', FULE_DATA_DIR: dataDirectory,
    FULE_API_IP_LIMIT: '10000', FULE_SOS_IP_LIMIT: '10000', SOCKETS_PER_IP_LIMIT: '2000', SOCKET_CONNECT_RATE_LIMIT: '2000',
    OPENAI_API_KEY: '', TWITCH_CLIENT_ID: '', TWITCH_CLIENT_SECRET: '', FULE_DEMO_GUARDIAN_INVITE: 'local-load-test-invite-only'
  },
  stdio: ['ignore', 'ignore', 'inherit']
});
const sockets = [];
const eventTimes = new Map();
const pending = new Map();
const latencies = [];
const errors = [];
const requestTimes = [];
const statusCounts = {};
const resourceSamples = [];
let stopped = false;

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)].toFixed(2));
}
function metric(text, name) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith(`${name} `));
  return line ? Number(line.split(' ')[1]) : null;
}
async function ready() {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Backend did not start in 15 seconds.');
}

try {
  await ready();
  const sample = async () => {
    try {
      const response = await fetch(`${origin}/metrics`);
      const body = await response.text();
      resourceSamples.push({ at: Date.now(), rss_bytes: metric(body, 'process_resident_memory_bytes'), cpu_user_seconds: metric(body, 'process_cpu_user_seconds_total'), cpu_system_seconds: metric(body, 'process_cpu_system_seconds_total') });
    } catch { }
  };
  await sample();
  const sampler = setInterval(() => { void sample(); }, 1000);

  const connected = [];
  for (let index = 0; index < clientCount; index += 1) {
    const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 15_000, extraHeaders: { Origin: frontendOrigin } });
    sockets.push(socket);
    connected.push(new Promise((resolveConnect) => {
      const timeout = setTimeout(() => resolveConnect(false), 15_000);
      socket.once('connect', () => { clearTimeout(timeout); resolveConnect(true); });
      socket.once('connect_error', () => { clearTimeout(timeout); resolveConnect(false); });
    }));
    socket.on('incident:public', (incident) => {
      eventTimes.set(incident.incident_id, Date.now());
      const started = pending.get(incident.incident_id);
      if (started) { latencies.push(Date.now() - started); pending.delete(incident.incident_id); }
    });
  }
  const connectedResults = await Promise.all(connected);
  const connectionsUp = connectedResults.filter(Boolean).length;
  if (connectionsUp !== clientCount) throw new Error(`Only ${connectionsUp}/${clientCount} socket clients connected.`);

  let requestsSent = 0;
  const requests = new Set();
  const startedAt = Date.now();
  const interval = setInterval(() => {
    if (stopped) return;
    const sequence = requestsSent++;
    const id = `baseline-${sequence}`;
    const requestStarted = Date.now();
    const task = (async () => {
      try {
        const response = await fetch(`${origin}/api/sos`, {
          method: 'POST', headers: { Origin: frontendOrigin, 'Content-Type': 'application/json', 'Idempotency-Key': `local-load:${sequence}:fule` },
          body: JSON.stringify({ streamer_id: id, location: { lat: 12.97, lng: 77.59, address: 'Synthetic test area' }, module_type: 'FULE_PROTECT', source: 'button', audio_transcript_snippet: 'Routine benchmark heartbeat; no assistance requested.' })
        });
        requestTimes.push(Date.now() - requestStarted);
        statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
        if (response.status !== 201) { errors.push(response.status); return; }
        const { incident } = await response.json();
        pending.set(incident.incident_id, requestStarted);
        const eventAt = eventTimes.get(incident.incident_id);
        if (eventAt) { latencies.push(eventAt - requestStarted); pending.delete(incident.incident_id); }
      } catch { errors.push('network'); }
    })().finally(() => requests.delete(task));
    requests.add(task);
  }, 1000 / eventRate);

  await new Promise((resolveRun) => setTimeout(resolveRun, durationSeconds * 1000));
  stopped = true;
  const loadWindowSeconds = (Date.now() - startedAt) / 1000;
  clearInterval(interval);
  await Promise.allSettled(requests);
  const deliveryDeadline = Date.now() + 10_000;
  while (pending.size && Date.now() < deliveryDeadline) await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  clearInterval(sampler);
  await sample();
  const result = {
    profile: { environment: 'single-process local demo; in-memory repository; no PostgreSQL or Redis', concurrent_socket_clients: connectionsUp, target_sos_per_second: eventRate, duration_seconds: durationSeconds, requests_sent: requestsSent, load_window_seconds: Number(loadWindowSeconds.toFixed(2)), achieved_sos_per_second: Number((requestsSent / loadWindowSeconds).toFixed(2)) },
    alerts: { delivered: latencies.length, missing: pending.size, request_errors: errors.length, request_error_rate: Number((errors.length / Math.max(requestsSent, 1)).toFixed(4)), response_status_counts: statusCounts, network_or_timeout_errors: errors.filter((error) => error === 'network').length, delivery_latency_ms: { p50: percentile(latencies, 0.50), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99) }, request_latency_ms: { p50: percentile(requestTimes, 0.50), p95: percentile(requestTimes, 0.95), p99: percentile(requestTimes, 0.99) } },
    resources: { backend_rss_peak_mb: Number((Math.max(...resourceSamples.map((item) => item.rss_bytes || 0)) / 1024 / 1024).toFixed(2)), backend_rss_final_mb: Number(((resourceSamples.at(-1)?.rss_bytes || 0) / 1024 / 1024).toFixed(2)), backend_cpu_user_seconds: Number(((resourceSamples.at(-1)?.cpu_user_seconds || 0) - (resourceSamples[0]?.cpu_user_seconds || 0)).toFixed(2)), backend_cpu_system_seconds: Number(((resourceSamples.at(-1)?.cpu_system_seconds || 0) - (resourceSamples[0]?.cpu_system_seconds || 0)).toFixed(2)), sample_count: resourceSamples.length, logical_cpu_count: cpus().length },
    limitations: ['This run does not use PostgreSQL, Redis, multiple API instances, TLS, Twitch, or a dispatch provider.', 'CPU and memory values are from the backend process Prometheus metrics; host, Postgres, and Redis resource use are not included.']
  };
  await mkdir(resolve('load-tests/results'), { recursive: true });
  await writeFile(resolve('load-tests/results/local-baseline.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  stopped = true;
  for (const socket of sockets) socket.disconnect();
  if (backend.exitCode === null) { backend.kill('SIGTERM'); await new Promise((resolveExit) => backend.once('exit', resolveExit)); }
  await rm(dataDirectory, { recursive: true, force: true });
}

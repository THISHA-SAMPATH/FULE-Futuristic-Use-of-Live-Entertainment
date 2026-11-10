import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireBackend = createRequire(resolve(root, 'backend/package.json'));
const requireFrontend = createRequire(resolve(root, 'frontend/package.json'));
requireBackend('dotenv').config({ path: resolve(root, '.env') });

if (!existsSync(resolve(root, '.env'))) {
  console.error('FAIL: .env is missing. Copy .env.example to .env, set local development secrets, then rerun.');
  process.exit(1);
}

const { chromium } = requireFrontend('playwright');
const { io } = requireFrontend('socket.io-client');
const knexFactory = requireBackend('knex');
const { S3Client, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = requireBackend('@aws-sdk/client-s3');
const apiUrl = process.env.FULE_SMOKE_API_URL || 'http://127.0.0.1:4000';
const publisherUrl = process.env.FULE_SMOKE_PUBLISHER_URL || 'http://127.0.0.1:5180/scripts/livekit-smoke.html';
const email = `livekit-smoke-${randomUUID()}@example.test`;
const password = `${randomUUID()}-Smoke-Test-Password`;
const location = { lat: 12.9716, lng: 77.5946 };
const idempotencyKey = `livekit-smoke:${randomUUID()}`;
let accountId; let incidentId; let socket; let browser; let page; let vite; let minioClient; let knex; let recordingKey;
let verified = false;

function runDocker(args, { allowFailure = false } = {}) {
  const result = spawnSync('docker', ['compose', ...args], { cwd: root, env: { ...process.env, DEMO_MODE: 'false' }, encoding: 'utf8', timeout: 120_000 });
  if (!allowFailure && result.status !== 0) throw new Error((result.stderr || result.stdout || `docker compose ${args.join(' ')} failed`).trim());
  return result;
}

async function waitUntil(label, check, timeoutMs = 45_000) {
  const expires = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < expires) {
    try { const result = await check(); if (result) return result; }
    catch (error) { lastError = error; }
    await delay(750);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function jsonRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${apiUrl}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${payload.error || 'no details'}`);
  return payload;
}

function sql(sqlText) {
  const result = runDocker(['exec', '-T', 'postgres', 'psql', '-U', 'fule', '-d', 'fule', '-Atc', sqlText]);
  return result.stdout.trim();
}

async function readObject(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

try {
  console.log('Starting the local Compose stack with real media mode enabled…');
  runDocker(['up', '-d', '--build']);
  await waitUntil('FULE API readiness', async () => {
    const response = await fetch(`${apiUrl}/api/ready`);
    return response.ok;
  }, 120_000);

  const registered = await jsonRequest('/api/auth/register', { method: 'POST', body: { email, password } });
  accountId = registered.account.account_id;
  const sos = await jsonRequest('/api/sos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${registered.access_token}`, 'Idempotency-Key': idempotencyKey },
    body: { streamer_id: accountId, location, module_type: 'FULE_PROTECT', source: 'button', audio_transcript_snippet: 'Routine media integration smoke test.' }
  });
  incidentId = sos.incident.incident_id;
  const access = await jsonRequest(`/api/incidents/${encodeURIComponent(incidentId)}/stream-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${registered.access_token}`, 'X-Streamer-Evidence-Token': sos.streamer_cancel_token },
    body: { streamer_id: accountId }
  });
  if (access.mode !== 'livekit' || !access.recording_enabled || !access.token || !access.server_url) {
    throw new Error(`Live recording is unavailable (mode=${access.mode}, recording_enabled=${access.recording_enabled}).`);
  }

  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], { cwd: resolve(root, 'frontend'), stdio: 'ignore', env: { ...process.env, VITE_DEMO_MODE: 'false' } });
  await waitUntil('publisher test page', async () => { const response = await fetch(publisherUrl); return response.ok; }, 30_000);
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  page = await browser.newPage();
  await page.goto(publisherUrl, { waitUntil: 'domcontentloaded' });
  const publishResult = await page.evaluate(({ serverUrl, token }) => window.startLiveKitSmokePublisher({ serverUrl, token }), { serverUrl: access.server_url, token: access.token });
  if (!publishResult.connected) throw new Error('Test publisher did not connect to the LiveKit room.');
  console.log('LiveKit publisher connected; publishing generated video for five seconds…');
  await delay(5_000);
  await page.evaluate(() => window.stopLiveKitSmokePublisher());

  socket = io(apiUrl, { auth: { accessToken: registered.access_token }, transports: ['websocket'], reconnection: false });
  await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error('Streamer Socket.IO connection timed out.')), 10_000);
    socket.once('connect', () => { clearTimeout(timeout); resolvePromise(); });
    socket.once('connect_error', (error) => { clearTimeout(timeout); rejectPromise(error); });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error('Streamer room registration timed out.')), 5_000);
    socket.once('streamer_registered', () => { clearTimeout(timeout); resolvePromise(); });
    socket.once('streamer_registration_failed', () => { clearTimeout(timeout); rejectPromise(new Error('Streamer room registration failed.')); });
    socket.emit('register_streamer', { incident_id: incidentId, streamer_id: accountId, cancel_token: sos.streamer_cancel_token });
  });
  await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => rejectPromise(new Error('Could not close test incident to finalize its recording.')), 5_000);
    socket.once('streamer_action_confirmed', () => { clearTimeout(timeout); resolvePromise(); });
    socket.emit('cancel_sos', { incident_id: incidentId });
  });

  const evidence = await waitUntil('LiveKit recording hash callback', async () => {
    const row = sql(`SELECT json_build_object('chunk_id',chunk_id,'sha256',sha256,'metadata',metadata)::text FROM evidence_chunks WHERE incident_id='${incidentId}' AND metadata->>'source'='livekit_egress' ORDER BY sequence DESC LIMIT 1`);
    if (!row) return null;
    return JSON.parse(row);
  }, 90_000);
  const metadata = evidence.metadata;
  recordingKey = metadata.s3_key;
  minioClient = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.FULE_SMOKE_S3_ENDPOINT || 'http://127.0.0.1:9000',
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
  });
  const object = await minioClient.send(new GetObjectCommand({ Bucket: metadata.s3_bucket, Key: recordingKey }));
  const bytes = await readObject(object.Body);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (!bytes.length || actualHash !== evidence.sha256) throw new Error(`Stored object hash mismatch (database=${evidence.sha256}, object=${actualHash}, bytes=${bytes.length}).`);
  verified = true;
  console.log(`PASS: LiveKit recording stored in MinIO and SHA-256 verified (${bytes.length} bytes, ${actualHash}).`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
} finally {
  try { await page?.evaluate(() => window.stopLiveKitSmokePublisher?.()); } catch { }
  try { socket?.disconnect(); } catch { }
  try { await browser?.close(); } catch { }
  try { vite?.kill(); } catch { }
  if (incidentId) {
    try {
      const prefix = `${String(process.env.LIVEKIT_EGRESS_PREFIX || 'fule-evidence').replace(/^\/+|\/+$/g, '')}/${incidentId}/`;
      const bucket = process.env.LIVEKIT_EGRESS_S3_BUCKET || 'fule-evidence';
      const listed = await minioClient?.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })).catch(() => null);
      for (const entry of listed?.Contents || []) await minioClient.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.Key }));
      if (recordingKey && !listed?.Contents?.length) await minioClient?.send(new DeleteObjectCommand({ Bucket: bucket, Key: recordingKey })).catch(() => {});
      runDocker(['exec', '-T', 'postgres', 'psql', '-U', 'fule', '-d', 'fule', '-c', `DELETE FROM audit_events WHERE incident_id='${incidentId}'; DELETE FROM incidents WHERE incident_id='${incidentId}';`], { allowFailure: true });
    } catch (cleanupError) { console.error(`CLEANUP WARNING: test incident cleanup failed: ${cleanupError.message}`); }
  }
  try { await minioClient?.destroy(); } catch { }
  if (accountId) runDocker(['exec', '-T', 'postgres', 'psql', '-U', 'fule', '-d', 'fule', '-c', `DELETE FROM accounts WHERE account_id='${accountId}';`], { allowFailure: true });
  if (!verified) process.exitCode = 1;
}

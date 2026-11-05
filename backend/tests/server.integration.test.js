import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const require = createRequire(fileURLToPath(new URL('../../frontend/package.json', import.meta.url)));
const { io } = require('socket.io-client');
const backendDir = fileURLToPath(new URL('../', import.meta.url));
let port;
let origin;
let child;
let dataDir;
const sockets = new Set();
const guardianInvite = 'integration-guardian-invite-2026';
const secondGuardianInvite = 'integration-second-guardian-invite-2026';
let cachedGuardian;

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const value = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return value;
}

async function waitForServer() {
  const expires = Date.now() + 8000;
  while (Date.now() < expires) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch { /* wait for child boot */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Integration backend did not start');
}

function socket(auth = {}) {
  const client = io(origin, { auth, transports: ['websocket'], reconnection: false, timeout: 3000 });
  sockets.add(client);
  return client;
}

function once(client, event, timeoutMs = 2500) {
  return new Promise((resolveOnce, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    client.once(event, (value) => { clearTimeout(timer); resolveOnce(value); });
    client.once('connect_error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function onceIncident(client, event, incidentId, timeoutMs = 2500) {
  return new Promise((resolveOnce, reject) => {
    const timer = setTimeout(() => { client.off(event, listener); reject(new Error(`Timed out waiting for ${event} on ${incidentId}`)); }, timeoutMs);
    const listener = (value) => {
      if (value?.incident_id !== incidentId) return;
      clearTimeout(timer); client.off(event, listener); resolveOnce(value);
    };
    client.on(event, listener);
  });
}

async function connected(client) {
  if (client.connected) return;
  await once(client, 'connect');
}

async function verifyGuardian() {
  if (cachedGuardian) return cachedGuardian;
  const response = await fetch(`${origin}/api/guardians/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_code: guardianInvite })
  });
  assert.equal(response.status, 200);
  cachedGuardian = await response.json();
  return cachedGuardian;
}

async function verifySecondGuardian() {
  const response = await fetch(`${origin}/api/guardians/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite_code: secondGuardianInvite }) });
  assert.equal(response.status, 200);
  return response.json();
}

async function createSos(streamerId, module_type = 'FULE_PROTECT', source = 'button', transcript = 'I am safe but would like someone to check in.') {
  return fetch(`${origin}/api/sos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `integration:${randomUUID()}` },
    body: JSON.stringify({
      streamer_id: streamerId,
      location: { lat: 12.9716, lng: 77.5946 },
      module_type,
      audio_transcript_snippet: transcript,
      source
    })
  });
}

before(async () => {
  port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  dataDir = await mkdtemp(join(tmpdir(), 'fule-integration-'));
  await writeFile(join(dataDir, 'guardians.json'), `${JSON.stringify([guardianInvite, secondGuardianInvite].map((invite, index) => ({ guardian_id: `integration-guardian-${index + 1}`, invite_code_hash: createHash('sha256').update(invite).digest('hex'), active: true, demo: true }))) }\n`);
  child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      FRONTEND_ORIGIN: origin,
      DEMO_MODE: 'true',
      DATABASE_URL: '',
      REDIS_URL: '',
      TWITCH_CLIENT_ID: 'integration-client-id',
      TWITCH_INTEGRATION_ENABLED: 'true',
      TWITCH_CLIENT_SECRET: 'integration-client-secret',
      TWITCH_REDIRECT_URI: `${origin}/auth/twitch/callback`,
      FULE_DEMO_GUARDIAN_INVITE: guardianInvite,
      FULE_DATA_DIR: dataDir,
      EVIDENCE_STORAGE_DIR: join(dataDir, 'evidence'),
      FULE_CONTACTS_DELAY_MS: '350',
      FULE_DISPATCH_DELAY_MS: '1000',
      FULE_ESCALATION_DELAY_MS: '1200',
      FULE_SOS_IP_LIMIT: '100',
      FULE_API_IP_LIMIT: '1000',
      FULE_DEFAULT_ROUTE_LIMIT: '600',
      FULE_TWITCH_SESSION_LIMIT: '1',
      FULE_GUARDIAN_VERIFY_LIMIT: '100',
      OPENAI_API_KEY: ''
    },
    stdio: 'ignore'
  });
  await waitForServer();
});

test('request IDs are echoed and route latency histograms are exported', async () => {
  const response = await fetch(`${origin}/api/health`, { headers: { 'X-Request-Id': 'integration-request-id-001' } });
  assert.equal(response.headers.get('x-request-id'), 'integration-request-id-001');
  assert.equal(response.status, 200);
  const allowed = await fetch(`${origin}/api/twitch/session`);
  assert.equal(allowed.status, 200);
  const limited = await fetch(`${origin}/api/twitch/session`);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  const metrics = await fetch(`${origin}/metrics`);
  const body = await metrics.text();
  assert.match(body, /fule_http_request_duration_seconds_bucket/);
  assert.match(body, /fule_http_requests_total/);
});

after(async () => {
  for (const client of sockets) client.disconnect();
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolveExit) => child.once('exit', resolveExit));
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

test('SOS create route accepts every supported module', async () => {
  for (const module_type of ['FULE_PROTECT', 'FULE_ACCOUNT', 'FULE_RESPOND']) {
    const response = await createSos(`module-${module_type}`, module_type);
    assert.equal(response.status, 201, `${module_type}: ${await response.clone().text()}`);
    const body = await response.json();
    assert.equal(body.incident.module, module_type);
  }
});

test('health reports demo degradation while SOS alert delivery still reaches connected guardians', async () => {
  const health = await (await fetch(`${origin}/api/health`)).json();
  assert.equal(health.alerts_available, true);
  assert.ok(health.degraded_modes.includes('database_demo_file_storage'));
  assert.ok(health.degraded_modes.includes('ai_deterministic_fallback'));
  const guardian = await verifyGuardian();
  const guardianSocket = socket({ guardianToken: guardian.access_token });
  await connected(guardianSocket);
  const alert = once(guardianSocket, 'sos_activated');
  const created = await createSos(`degraded-${randomUUID()}`);
  assert.equal(created.status, 201);
  const { incident } = await created.json();
  assert.equal((await alert).incident_id, incident.incident_id);
  guardianSocket.disconnect();
});

test('SOS idempotency key returns the original incident on retry', async () => {
  const payload = {
    streamer_id: 'idempotency-streamer',
    location: { lat: 12.9716, lng: 77.5946 },
    module_type: 'FULE_PROTECT', source: 'button',
    audio_transcript_snippet: 'Routine idempotency test check-in.'
  };
  const post = () => fetch(`${origin}/api/sos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'repeat-request-0001' }, body: JSON.stringify(payload)
  });
  const first = await post(); const firstBody = await first.json();
  const retry = await post(); const retryBody = await retry.json();
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retryBody.incident.incident_id, firstBody.incident.incident_id);
  assert.equal(retryBody.streamer_cancel_token, firstBody.streamer_cancel_token);
});

test('SOS requires an idempotency key and replays the original response on client retry', async () => {
  const payload = { streamer_id: 'required-idempotency', location: { lat: 12.9716, lng: 77.5946 }, module_type: 'FULE_PROTECT', source: 'button', audio_transcript_snippet: '' };
  const missing = await fetch(`${origin}/api/sos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /Idempotency-Key/);
  const key = `retry:${randomUUID()}`;
  const request = () => fetch(`${origin}/api/sos`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload) });
  const [first, second] = await Promise.all([request(), request()]);
  const firstBody = await first.json(); const secondBody = await second.json();
  assert.equal(first.status, 201);
  assert.ok([200, 201].includes(second.status));
  assert.equal(firstBody.incident.incident_id, secondBody.incident.incident_id);
  assert.equal(firstBody.streamer_cancel_token, secondBody.streamer_cancel_token);
});

test('parallel guardian acknowledgement requests have exactly one winner', async () => {
  const firstGuardian = await verifyGuardian();
  const secondGuardian = await verifySecondGuardian();
  assert.notEqual(firstGuardian.guardian_id, secondGuardian.guardian_id);
  const created = await createSos(`parallel-ack-${randomUUID()}`);
  const { incident } = await created.json();
  const acknowledge = (token) => fetch(`${origin}/api/incidents/${incident.incident_id}/acknowledge`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  const [left, right] = await Promise.all([acknowledge(firstGuardian.access_token), acknowledge(secondGuardian.access_token)]);
  const results = await Promise.all([left.json(), right.json()]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  const winner = left.status === 200 ? firstGuardian : secondGuardian;
  assert.equal(results[left.status === 200 ? 0 : 1].incident.acknowledged_by, winner.guardian_id);
  assert.match(results[left.status === 409 ? 0 : 1].error, /already acknowledged/i);
});

test('stream token route scopes access to the streamer session and rejects a closed incident', async () => {
  const streamerId = `live-stream-${randomUUID()}`;
  const createdResponse = await createSos(streamerId);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const endpoint = `${origin}/api/incidents/${created.incident.incident_id}/stream-token`;
  const unauthorized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamer_id: streamerId }) });
  assert.equal(unauthorized.status, 403);
  const guardian = await verifyGuardian();
  const unacceptedGuardian = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guardian.access_token}` }, body: '{}' });
  assert.equal(unacceptedGuardian.status, 403);
  const tokenResponse = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Streamer-Evidence-Token': created.streamer_cancel_token }, body: JSON.stringify({ streamer_id: streamerId }) });
  assert.equal(tokenResponse.status, 200);
  const demoToken = await tokenResponse.json(); assert.equal(demoToken.mode, 'demo'); assert.equal(demoToken.can_publish, true);
  const streamerSocket = socket(); await connected(streamerSocket);
  const registered = once(streamerSocket, 'streamer_registered');
  streamerSocket.emit('register_streamer', { incident_id: created.incident.incident_id, streamer_id: streamerId, cancel_token: created.streamer_cancel_token }); await registered;
  const canceled = once(streamerSocket, 'streamer_action_confirmed'); streamerSocket.emit('cancel_sos', { incident_id: created.incident.incident_id }); await canceled;
  const closed = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Streamer-Evidence-Token': created.streamer_cancel_token }, body: JSON.stringify({ streamer_id: streamerId }) });
  assert.equal(closed.status, 409);
  streamerSocket.disconnect();
});

test('central guardian authorization rejects expired access tokens with 401', async () => {
  const expired = jwt.sign({ sub: 'expired-guardian', role: 'guardian' }, 'development-only-secret-change-this-before-production', { expiresIn: -1, issuer: 'fule' });
  const response = await fetch(`${origin}/api/incidents`, { headers: { Authorization: `Bearer ${expired}` } });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /expired/i);
});

test('nearby on-duty guardian sees approximate area until acceptance reveals exact incident location', async () => {
  const guardian = await verifyGuardian();
  const guardianSocket = socket({ guardianToken: guardian.access_token });
  await connected(guardianSocket);
  const duty = await fetch(`${origin}/api/guardians/duty`, {
    method: 'POST', headers: { Authorization: `Bearer ${guardian.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ on_duty: true, location: { lat: 12.9716, lng: 77.5946 } })
  });
  assert.equal(duty.status, 200);
  const dutyResult = await duty.json();
  assert.equal(Object.hasOwn(dutyResult, 'lat'), false);
  const offerEvent = once(guardianSocket, 'nearby_sos_offer');
  const response = await createSos('nearby-private-streamer');
  assert.equal(response.status, 201);
  const { incident } = await response.json();
  const offer = await offerEvent;
  assert.equal(offer.incident_id, incident.incident_id);
  assert.equal(offer.approximate_area.includes('12.9716'), false);
  assert.equal(Object.hasOwn(offer, 'lat'), false);
  const beforeAcceptance = await fetch(`${origin}/api/incidents?limit=100`, { headers: { Authorization: `Bearer ${guardian.access_token}` } });
  const pendingIncident = (await beforeAcceptance.json()).incidents.find((item) => item.incident_id === incident.incident_id);
  assert.equal(pendingIncident.location.lat, 12.97);
  assert.equal(pendingIncident.summary.includes('Precise location'), true);
  const acceptedResponse = await fetch(`${origin}/api/incidents/${incident.incident_id}/nearby-accept`, {
    method: 'POST', headers: { Authorization: `Bearer ${guardian.access_token}`, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(acceptedResponse.status, 200);
  const accepted = await acceptedResponse.json();
  assert.equal(accepted.incident.location.lat, 12.9716);
  assert.equal(accepted.incident.location.lng, 77.5946);
  const offDuty = await fetch(`${origin}/api/guardians/duty`, { method: 'POST', headers: { Authorization: `Bearer ${guardian.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ on_duty: false }) });
  assert.equal(offDuty.status, 200);
  guardianSocket.disconnect();
});

test('safe-walk HTTP flow protects state with the session token and accepts a check-in then cancel', async () => {
  const start = await fetch(`${origin}/api/safe-walks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamer_id: 'safe-walk-api-test', destination: 'Central station', eta_minutes: 25, check_in_interval_minutes: 5, safe_pin: '1234', duress_pin: '5678', location: { lat: 12.9716, lng: 77.5946 } })
  });
  assert.equal(start.status, 201, await start.clone().text());
  const created = await start.json();
  const forbidden = await fetch(`${origin}/api/safe-walks/${created.walk.walk_id}`);
  assert.equal(forbidden.status, 403);
  const checkin = await fetch(`${origin}/api/safe-walks/${created.walk.walk_id}/check-in`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Safe-Walk-Token': created.session_token }, body: JSON.stringify({ pin: '1234' })
  });
  assert.equal(checkin.status, 200);
  assert.equal((await checkin.json()).status, 'CHECKED_IN');
  const cancel = await fetch(`${origin}/api/safe-walks/${created.walk.walk_id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Safe-Walk-Token': created.session_token }, body: '{}'
  });
  assert.equal(cancel.status, 200);
  assert.equal((await cancel.json()).status, 'CANCELLED');
});

test('safe-walk push subscription is validated and stored per signed-in streamer', async () => {
  const subscription = { endpoint: 'https://fcm.googleapis.com/subscription/opaque', keys: { p256dh: 'base64url-public-key', auth: 'base64url-auth-secret' } };
  const response = await fetch(`${origin}/api/safe-walks/push-subscription`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamer_id: 'push-streamer', subscription })
  });
  assert.equal(response.status, 201, await response.clone().text());
  assert.deepEqual(await response.json(), { ok: true });
  const invalid = await fetch(`${origin}/api/safe-walks/push-subscription`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamer_id: 'push-streamer', subscription: { ...subscription, endpoint: 'http://not-secure.invalid/push' } })
  });
  assert.equal(invalid.status, 400);
  const removed = await fetch(`${origin}/api/safe-walks/push-subscription`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamer_id: 'push-streamer', endpoint: subscription.endpoint })
  });
  assert.equal(removed.status, 200);
});

test('duress check-in appears normal to the streamer and silently escalates only to guardians', async () => {
  const guardian = await verifyGuardian();
  const guardianSocket = socket({ guardianToken: guardian.access_token });
  const publicSocket = socket();
  await Promise.all([connected(guardianSocket), connected(publicSocket)]);
  const start = await fetch(`${origin}/api/safe-walks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ streamer_id: 'duress-api-test', destination: 'Home', eta_minutes: 15, check_in_interval_minutes: 5, safe_pin: '1234', duress_pin: '9876', location: { lat: 12.9716, lng: 77.5946 } })
  });
  assert.equal(start.status, 201);
  const walk = await start.json();
  const guardianAlert = once(guardianSocket, 'sos_activated');
  let publicIncident = false;
  publicSocket.once('incident:public', () => { publicIncident = true; });
  const checkin = await fetch(`${origin}/api/safe-walks/${walk.walk.walk_id}/check-in`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Safe-Walk-Token': walk.session_token }, body: JSON.stringify({ pin: '9876' })
  });
  assert.equal(checkin.status, 200);
  const visibleResponse = await checkin.json();
  assert.equal(visibleResponse.status, 'CHECKED_IN');
  assert.equal(Object.hasOwn(visibleResponse, 'incident'), false);
  const privateIncident = await guardianAlert;
  assert.equal(privateIncident.streamer_contact.display_name, 'Demo Streamer');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(publicIncident, false);
  guardianSocket.disconnect(); publicSocket.disconnect();
});

test('demo API accepts Vite fallback localhost origins with CORS credentials', async () => {
  const fallbackOrigin = 'http://127.0.0.1:5174';
  const response = await fetch(`${origin}/api/sos`, {
    method: 'POST',
    headers: { Origin: fallbackOrigin, 'Content-Type': 'application/json', 'Idempotency-Key': `vite-fallback:${randomUUID()}` },
    body: JSON.stringify({
      streamer_id: 'vite-fallback-origin',
      location: { lat: 12.9716, lng: 77.5946 },
      module_type: 'FULE_PROTECT',
      source: 'button',
      audio_transcript_snippet: 'Synthetic fallback-origin test'
    })
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('access-control-allow-origin'), fallbackOrigin);
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
});

test('Twitch OAuth route redirects with scopes and browser-bound one-time state', async () => {
  const start = await fetch(`${origin}/auth/twitch`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const authorization = new URL(start.headers.get('location'));
  assert.equal(authorization.origin, 'https://id.twitch.tv');
  assert.equal(authorization.pathname, '/oauth2/authorize');
  assert.equal(authorization.searchParams.get('client_id'), 'integration-client-id');
  assert.equal(authorization.searchParams.get('response_type'), 'code');
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/auth/twitch/callback`);
  assert.ok(authorization.searchParams.get('scope').includes('user:read:chat'));
  assert.ok(authorization.searchParams.get('scope').includes('channel:read:redemptions'));
  assert.ok(authorization.searchParams.get('scope').includes('clips:edit'));
  assert.ok(authorization.searchParams.get('scope').includes('channel:manage:redemptions'));
  const setCookie = start.headers.get('set-cookie') || '';
  const boundState = setCookie.match(/fule_twitch_oauth_state=([^;]+)/)?.[1];
  assert.equal(boundState, authorization.searchParams.get('state'));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);

  const callback = new URL(`${origin}/auth/twitch/callback`);
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  callback.searchParams.set('error', 'access_denied');
  const forged = await fetch(callback, { headers: { Cookie: 'fule_twitch_oauth_state=wrong-browser' } });
  assert.equal(forged.status, 400);
  assert.match(await forged.text(), /Invalid or expired Twitch authorization state/);
});

test('guardian receives exact incident while public room receives redacted event', async () => {
  const guardian = await verifyGuardian();
  const privateSocket = socket({ guardianToken: guardian.access_token });
  const publicSocket = socket();
  await Promise.all([connected(privateSocket), connected(publicSocket)]);
  const privateEvent = once(privateSocket, 'sos_activated');
  const publicEvent = once(publicSocket, 'incident:public');
  const response = await createSos('redaction-streamer');
  assert.equal(response.status, 201);
  const [privateIncident, publicIncident] = await Promise.all([privateEvent, publicEvent]);
  assert.equal(privateIncident.location.lat, 12.9716);
  assert.equal(privateIncident.location.lng, 77.5946);
  assert.equal(publicIncident.location.lat, 12.97);
  assert.equal(publicIncident.location.lng, 77.59);
  assert.equal(publicIncident.summary.includes('following'), false);
  assert.equal(publicIncident.stream_url, null);
  assert.equal(publicIncident.transcript_snippet, '');
  assert.equal(publicIncident.dispatch_record, null);
  assert.equal((await (await fetch(`${origin}/api/incidents`)).json()).error, 'Verified guardian access required.');
  const history = await fetch(`${origin}/api/incidents`, { headers: { Authorization: `Bearer ${guardian.access_token}` } });
  assert.equal(history.status, 200);
  assert.ok((await history.json()).incidents.some((item) => item.incident_id === privateIncident.incident_id));
});

test('evidence chunk upload is encrypted at rest and appears in a verified case file', async () => {
  const guardian = await verifyGuardian();
  const response = await createSos('evidence-streamer');
  assert.equal(response.status, 201);
  const created = await response.json();
  const bytes = Buffer.from('synthetic short audio evidence');
  const upload = await fetch(`${origin}/api/incidents/${created.incident.incident_id}/evidence`, {
    method: 'POST', headers: { 'Content-Type': 'audio/webm', 'X-Streamer-Evidence-Token': created.streamer_cancel_token }, body: bytes
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const { evidence } = await upload.json();
  const caseResponse = await fetch(`${origin}/api/incidents/${created.incident.incident_id}/case-file`, { headers: { Authorization: `Bearer ${guardian.access_token}` } });
  assert.equal(caseResponse.status, 200);
  const caseFile = await caseResponse.json();
  assert.equal(caseFile.integrity.valid, true);
  assert.equal(caseFile.integrity.files_valid, true);
  assert.equal(caseFile.evidence[0].sha256, evidence.sha256);
  const download = await fetch(`${origin}/api/incidents/${created.incident.incident_id}/evidence/${evidence.chunk_id}`, { headers: { Authorization: `Bearer ${guardian.access_token}` } });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
});

test('verified guardian acknowledgement sets registry identity and broadcasts state', async () => {
  const guardian = await verifyGuardian();
  const privateSocket = socket({ guardianToken: guardian.access_token });
  await connected(privateSocket);
  const activated = once(privateSocket, 'sos_activated');
  const response = await createSos('ack-streamer');
  assert.equal(response.status, 201);
  const incident = await activated;
  const acknowledgedEvent = once(privateSocket, 'incident_acknowledged');
  privateSocket.emit('acknowledge_incident', incident.incident_id);
  const acknowledged = await acknowledgedEvent;
  assert.equal(acknowledged.status, 'ACKNOWLEDGED');
  assert.equal(acknowledged.acknowledged_by, guardian.guardian_id);
});

test('streamer can cancel during grace and false-alarm flow is accepted', async () => {
  for (const [streamerId, eventName, expected] of [
    ['cancel-streamer', 'cancel_sos', 'CANCELLED'],
    ['false-streamer', 'false_alarm', 'FALSE_ALARM']
  ]) {
    const publicSocket = socket();
    await connected(publicSocket);
    const activated = once(publicSocket, 'incident:public');
    const response = await createSos(streamerId);
    const body = await response.json();
    assert.equal(response.status, 201);
    const incident = await activated;
    const streamerSocket = socket();
    await connected(streamerSocket);
    const registered = once(streamerSocket, 'streamer_registered');
    streamerSocket.emit('register_streamer', {
      incident_id: incident.incident_id,
      streamer_id: streamerId,
      cancel_token: body.streamer_cancel_token
    });
    await registered;
    const canceled = once(publicSocket, 'incident:public:update');
    streamerSocket.emit(eventName, { incident_id: incident.incident_id });
    assert.equal((await canceled).status, expected);
  }
});

test('unacknowledged SOS escalates and flags emergency services reminder', async () => {
  const guardian = await verifyGuardian();
  const privateSocket = socket({ guardianToken: guardian.access_token });
  await connected(privateSocket);
  const activation = once(privateSocket, 'sos_activated');
  const response = await createSos('escalate-streamer');
  assert.equal(response.status, 201);
  const created = await activation;
  const escalation = onceIncident(privateSocket, 'incident_escalated', created.incident_id);
  const result = await escalation;
  assert.equal(result.incident_id, created.incident_id);
  assert.equal(result.status, 'ESCALATED');
  assert.equal(result.escalated, true);
  assert.match(result.escalation_flag, /112/);
  assert.equal(result.dispatch_record.status, 'SENT');
});

test('T+30 notifies configured trusted contacts using the demo Twilio fallback', async () => {
  const guardian = await verifyGuardian();
  const privateSocket = socket({ guardianToken: guardian.access_token });
  await connected(privateSocket);
  const saved = await fetch(`${origin}/api/streamer/trusted-contacts`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamer_id: 'contact-streamer', contacts: [{ name: 'Trusted Friend', phone: '+14155550123' }] }) });
  assert.equal(saved.status, 200);
  const activated = once(privateSocket, 'sos_activated');
  const response = await createSos('contact-streamer');
  assert.equal(response.status, 201);
  const incident = await activated;
  const notified = onceIncident(privateSocket, 'trusted_contacts_notified', incident.incident_id, 2500);
  const result = await notified;
  assert.equal(result.status, 'MOCKED');
  assert.equal(result.count, 1);
});

test('CRITICAL SOS dispatches immediately', async () => {
  const dispatchSocket = socket();
  await connected(dispatchSocket);
  const sent = once(dispatchSocket, 'dispatch_sent', 2500);
  const response = await createSos('critical-streamer', 'FULE_PROTECT', 'button', 'Weapon reported. Immediate danger.');
  assert.equal(response.status, 201);
  const incident = await sent;
  assert.equal(incident.dispatch_record.status, 'SENT');
  assert.equal(incident.dispatch_record.simulated, true);
});

test('stand-down is required after dispatch has been sent and updates the control room feed', async () => {
  const dispatcher = socket();
  await connected(dispatcher);
  const sent = once(dispatcher, 'dispatch_sent', 2500);
  const response = await createSos('stand-down-streamer', 'FULE_PROTECT', 'button', 'I feel uncomfortable, please check in.');
  assert.equal(response.status, 201);
  const incident = await sent;
  const stopped = await fetch(`${origin}/api/dispatch/${incident.incident_id}/action`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'STAND_DOWN', reason: 'Situation is safe.' })
  });
  assert.equal(stopped.status, 200, await stopped.clone().text());
  assert.equal((await stopped.json()).incident.dispatch_stage, 'STAND_DOWN');
});

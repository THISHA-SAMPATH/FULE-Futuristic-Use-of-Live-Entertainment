import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../frontend/package.json', import.meta.url)));
const { io } = require('socket.io-client');
const backendDir = fileURLToPath(new URL('../', import.meta.url));
let port;
let origin;
let child;
let dataDir;
const sockets = new Set();
const guardianInvite = 'integration-guardian-invite-2026';

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
  const response = await fetch(`${origin}/api/guardians/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_code: guardianInvite })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function createSos(streamerId, module_type = 'FULE_PROTECT', source = 'button') {
  return fetch(`${origin}/api/sos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      streamer_id: streamerId,
      location: { lat: 12.9716, lng: 77.5946 },
      module_type,
      audio_transcript_snippet: 'Someone is following me. Please help.',
      source
    })
  });
}

before(async () => {
  port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  dataDir = await mkdtemp(join(tmpdir(), 'fule-integration-'));
  child = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(port),
      FRONTEND_ORIGIN: origin,
      DEMO_MODE: 'true',
      TWITCH_CLIENT_ID: 'integration-client-id',
      TWITCH_CLIENT_SECRET: 'integration-client-secret',
      TWITCH_REDIRECT_URI: `${origin}/auth/twitch/callback`,
      FULE_DEMO_GUARDIAN_INVITE: guardianInvite,
      FULE_DATA_DIR: dataDir,
      FULE_DISPATCH_GRACE_MS: '600',
      FULE_ESCALATION_DELAY_MS: '1200',
      FULE_SOS_IP_LIMIT: '30',
      OPENAI_API_KEY: ''
    },
    stdio: 'ignore'
  });
  await waitForServer();
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
  assert.equal((await (await fetch(`${origin}/api/incidents`)).json()).error, 'Verified guardian access required.');
  const history = await fetch(`${origin}/api/incidents`, { headers: { Authorization: `Bearer ${guardian.access_token}` } });
  assert.equal(history.status, 200);
  assert.ok((await history.json()).incidents.some((item) => item.incident_id === privateIncident.incident_id));
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
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { TokenVerifier } from 'livekit-server-sdk';
import { createLiveStreamService } from '../services/liveStreamService.js';
import { createEvidenceEntry, verifyEvidenceChain } from '../services/safetyFeatures.js';
import { authenticateTrustedContactStreamToken, createTrustedContactStreamToken } from '../services/accountService.js';

const activeIncident = { incident_id: 'incident-live-001', streamer_id: 'streamer-01', status: 'PENDING_DISPATCH', created_at: new Date().toISOString() };

test('demo stream works without camera or LiveKit credentials and denies unauthorized tokens', async () => {
  const service = createLiveStreamService({ env: { DEMO_MODE: 'true' } });
  const demo = await service.issueToken({ incident: activeIncident, principal: { id: 'streamer-01' }, role: 'streamer', authorized: true });
  assert.equal(demo.simulated, true); assert.equal(demo.source, 'generated-test-pattern'); assert.equal(demo.can_publish, true);
  await assert.rejects(service.issueToken({ incident: activeIncident, principal: { id: 'public-user' }, role: 'guardian', authorized: false }), { status: 403 });
});

test('LiveKit JWT is scoped to one incident room and role permissions', async () => {
  const createdRooms = [];
  const service = createLiveStreamService({
    env: { DEMO_MODE: 'false', LIVEKIT_URL: 'wss://media.fule.local', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'test-secret', LIVEKIT_TOKEN_TTL_SECONDS: '120' },
    roomService: { createRoom: async ({ name }) => createdRooms.push(name) },
    egressClient: { startRoomCompositeEgress: async () => ({ egressId: 'egress-1' }) }
  });
  const streamer = await service.issueToken({ incident: activeIncident, principal: { id: 'streamer-01' }, role: 'streamer', authorized: true });
  const claims = await new TokenVerifier('test-key', 'test-secret').verify(streamer.token);
  assert.equal(claims.video.room, streamer.room); assert.equal(claims.video.canPublish, true); assert.equal(claims.video.canSubscribe, false);
  assert.equal(streamer.server_url, 'wss://media.fule.local'); assert.deepEqual(createdRooms, [streamer.room]);
  const guardian = await service.issueToken({ incident: activeIncident, principal: { id: 'guardian-01' }, role: 'guardian', authorized: true });
  const guardianClaims = await new TokenVerifier('test-key', 'test-secret').verify(guardian.token);
  assert.equal(guardianClaims.video.room, streamer.room); assert.equal(guardianClaims.video.canPublish, false); assert.equal(guardianClaims.video.canSubscribe, true);
});

test('self-hosted TURN credentials are short-lived and participant-scoped', async () => {
  const now = 1_800_000_000_000;
  const service = createLiveStreamService({
    env: { DEMO_MODE: 'false', LIVEKIT_URL: 'ws://media.fule.local', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret', TURN_SHARED_SECRET: 'turn-secret', LIVEKIT_TURN_URL: 'turn:turn.fule.local:3478?transport=udp' },
    now: () => now,
    roomService: { createRoom: async () => {} }
  });
  const result = await service.issueToken({ incident: activeIncident, principal: { id: 'guardian-01' }, role: 'guardian', authorized: true });
  const turn = result.ice_servers.iceServers[0];
  assert.equal(turn.urls[0], 'turn:turn.fule.local:3478?transport=udp');
  assert.match(turn.username, /^1800000180:guardian:guardian-01$/);
  assert.equal(turn.credential, createHmac('sha1', 'turn-secret').update(turn.username).digest('base64'));
});

test('closing an incident revokes room tokens and removes participants', async () => {
  const removed = []; const deleted = [];
  const service = createLiveStreamService({
    env: { DEMO_MODE: 'false', LIVEKIT_URL: 'https://media.fule.local', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' },
    roomService: { createRoom: async () => {}, listParticipants: async () => [{ identity: 'streamer:a' }, { identity: 'guardian:b' }], removeParticipant: async (room, identity, options) => removed.push({ room, identity, options }), deleteRoom: async (room) => deleted.push(room) }
  });
  await service.issueToken({ incident: activeIncident, principal: { id: 'streamer-01' }, role: 'streamer', authorized: true });
  await service.revokeIncident(activeIncident.incident_id);
  assert.equal(removed.length, 2); assert.ok(removed.every((item) => item.options.revokeTokenTs > 0n)); assert.equal(deleted.length, 1);
  await assert.rejects(service.issueToken({ incident: activeIncident, principal: { id: 'streamer-01' }, role: 'streamer', authorized: true }), { status: 410 });
});

test('trusted-circle links are signed, short-lived, and scoped to one incident and streamer', () => {
  const token = createTrustedContactStreamToken({ incidentId: activeIncident.incident_id, streamerId: activeIncident.streamer_id, contactEmail: 'friend@example.test' });
  assert.equal(authenticateTrustedContactStreamToken(token, activeIncident.incident_id, activeIncident.streamer_id)?.role, 'trusted_contact');
  assert.equal(authenticateTrustedContactStreamToken(token, 'other-incident', activeIncident.streamer_id), null);
  assert.equal(authenticateTrustedContactStreamToken(token, activeIncident.incident_id, 'other-streamer'), null);
});

test('LiveKit recording is hashed from S3 bytes into the append-only evidence chain', async () => {
  const bytes = Buffer.from('synthetic livekit recording bytes'); const entries = [];
  const evidenceStore = { appendEvidence: async ({ incident_id, build }) => { const entry = build(entries.length + 1, entries.at(-1)?.chain_hash || '0'.repeat(64)); entries.push(entry); return entry; }, listExpiredStreamRecordings: async () => [] };
  const evidenceVault = { appendExternalHash: async (incidentId, payload) => evidenceStore.appendEvidence({ incident_id: incidentId, build: (sequence, previousHash) => createEvidenceEntry({ chunk_id: `recording-${sequence}`, incident_id: incidentId, sequence, recorded_at: payload.recordedAt, storage_key: payload.storageKey, sha256: payload.sha256, previous_hash: previousHash, metadata: payload.metadata }) }), appendRetentionTombstone: async () => {} };
  const service = createLiveStreamService({
    env: { DEMO_MODE: 'false', LIVEKIT_URL: 'https://media.fule.local', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret', LIVEKIT_WEBHOOK_URL: 'http://fule.local:4000/api/livekit/webhook', LIVEKIT_EGRESS_S3_BUCKET: 'fule-test', AWS_ACCESS_KEY_ID: 'id', AWS_SECRET_ACCESS_KEY: 'secret', AWS_S3_ENDPOINT: 'http://minio:9000', LIVEKIT_EGRESS_PREFIX: 'fule-evidence' },
    evidenceVault, evidenceStore, roomService: { createRoom: async () => {} },
    egressClient: { startRoomCompositeEgress: async (_room, _output, options) => { assert.equal(options.webhooks[0].url, 'http://fule.local:4000/api/livekit/webhook'); return { egressId: 'eg-1' }; } },
    webhookReceiver: { receive: async () => ({ event: 'egress_ended', egressInfo: { roomName: service.roomName(activeIncident.incident_id), fileResults: [{ filename: `${'fule-evidence'}/${activeIncident.incident_id}/recording.mp4`, endedAt: String(Date.now() * 1_000_000) }] } }) },
    s3ObjectReader: async () => bytes
  });
  await service.issueToken({ incident: activeIncident, principal: { id: 'streamer-01' }, role: 'streamer', authorized: true });
  const result = await service.handleWebhook('{}', 'signed');
  assert.equal(result.handled, true); assert.equal(result.evidence.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(entries[0].metadata.source, 'livekit_egress'); assert.equal(verifyEvidenceChain(entries).valid, true);
});

test('retention deletes expired S3 recordings and appends an auditable tombstone', async () => {
  const old = { incident_id: 'old-incident', chunk_id: 'recording-old', sequence: 1, recorded_at: new Date(0).toISOString(), sha256: 'a'.repeat(64), metadata: { s3_bucket: 'bucket', s3_key: 'old.mp4' } };
  const evidenceStore = { listExpiredStreamRecordings: async () => [old] };
  const evidenceVault = { appendRetentionTombstone: async (entry) => { assert.equal(entry.chunk_id, old.chunk_id); } };
  const deleted = [];
  const service = createLiveStreamService({ env: { LIVEKIT_RECORDING_RETENTION_DAYS: '1' }, evidenceVault, evidenceStore, s3ObjectDeleter: async (...args) => deleted.push(args) });
  const removed = await service.pruneRecordings({ now: 5 * 86_400_000 });
  assert.deepEqual(deleted, [['bucket', 'old.mp4']]); assert.deepEqual(removed, [{ incident_id: 'old-incident', evidence_sequence: 1 }]);
});

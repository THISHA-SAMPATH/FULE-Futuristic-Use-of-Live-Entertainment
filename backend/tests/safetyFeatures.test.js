import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSafeWalkWorkflow, createEvidenceEntry, matchNearbyGuardians, verifyEvidenceChain } from '../services/safetyFeatures.js';
import { EvidenceVault } from '../services/evidenceVault.js';

function fixture() {
  const rows = new Map();
  const jobs = new Map();
  const store = {
    create: async (walk, hashes) => rows.set(walk.walk_id, { walk, ...hashes }),
    get: async (id) => rows.get(id),
    update: async (walk) => { rows.get(walk.walk_id).walk = walk; }
  };
  const queue = {
    scheduleCheckin: async (walkId, checkin, delay) => jobs.set(`${walkId}:checkin:${checkin}`, { type: 'checkin', walkId, checkin, delay }),
    scheduleTimeout: async (walkId, checkin, delay) => jobs.set(`${walkId}:timeout:${checkin}`, { type: 'timeout', walkId, checkin, delay }),
    cancelWalkJobs: async (walkId) => { for (const key of jobs.keys()) if (key.startsWith(`${walkId}:`)) jobs.delete(key); }
  };
  return { rows, jobs, store, queue };
}

test('safe-walk timer recovery uses durable walk state and queued timeout to auto-trigger with last location', async () => {
  const data = fixture();
  let now = Date.parse('2026-11-04T10:00:00Z');
  const sosCalls = [];
  const makeWorkflow = () => createSafeWalkWorkflow({ store: data.store, queue: data.queue, notify: async () => {}, triggerSos: async (input) => { sosCalls.push(input); return { incident: { incident_id: 'sos-safe-walk' } }; }, now: () => now });
  const firstProcess = makeWorkflow();
  const { walk, session_token } = await firstProcess.start({ streamer_id: 'streamer-1', destination: 'Home', eta_minutes: 30, check_in_interval_minutes: 1, safe_pin: '1234', duress_pin: '5678', location: { lat: 12.97, lng: 77.59 } });
  assert.equal(data.jobs.get(`${walk.walk_id}:checkin:1`).delay, 60_000);
  now += 60_000;
  assert.equal(await firstProcess.checkinDue(walk.walk_id, 1), true);
  assert.equal(data.jobs.get(`${walk.walk_id}:timeout:1`).delay, 60_000);

  // The restarted worker has fresh workflow memory but reads persisted walk state and the durable job payload.
  const restartedProcess = makeWorkflow();
  now += 60_000;
  const result = await restartedProcess.timeout(walk.walk_id, 1);
  assert.equal(result.incident.incident_id, 'sos-safe-walk');
  assert.equal(sosCalls[0].location.lat, 12.97);
  assert.equal(sosCalls[0].location.lng, 77.59);
  assert.match(sosCalls[0].audio_transcript_snippet, /last known location trail/i);
  assert.equal((await data.store.get(walk.walk_id)).walk.status, 'SOS_TRIGGERED');
  assert.equal(session_token.length > 20, true);
});

test('duress PIN looks like a successful normal check-in while triggering an SOS', async () => {
  const data = fixture();
  let calls = 0;
  let sosPayload;
  const workflow = createSafeWalkWorkflow({ store: data.store, queue: data.queue, notify: async () => {}, triggerSos: async (payload) => { calls += 1; sosPayload = payload; return { incident: { incident_id: 'sos-duress' } }; } });
  const { walk, session_token } = await workflow.start({ streamer_id: 'streamer-2', destination: 'Transit stop', eta_minutes: 20, check_in_interval_minutes: 5, safe_pin: '1111', duress_pin: '2222' });
  const result = await workflow.checkin(walk.walk_id, session_token, '2222');
  assert.deepEqual({ ok: result.ok, status: result.status }, { ok: true, status: 'CHECKED_IN' });
  assert.equal(result.duress, true);
  assert.equal(calls, 1);
  assert.equal(sosPayload.silent_public, true);
  assert.equal((await data.store.get(walk.walk_id)).walk.status, 'CANCELLED');
});

test('nearby guardian matching observes radius, nearest-first order, verification and approximate-area privacy', () => {
  const matched = matchNearbyGuardians({ lat: 0, lng: 0 }, [
    { guardian_id: 'far', lat: 0, lng: 0.006, verified: true, on_duty: true, area_label: 'Outer district' },
    { guardian_id: 'near', lat: 0, lng: 0.001, verified: true, on_duty: true, area_label: 'Central district' },
    { guardian_id: 'unverified', lat: 0, lng: 0.0001, verified: false, on_duty: true },
    { guardian_id: 'off-duty', lat: 0, lng: 0.0001, verified: true, on_duty: false }
  ], { radiusMeters: 400 });
  assert.deepEqual(matched.map((item) => item.guardian_id), ['near']);
  assert.equal(matched[0].approximate_area, 'Central district');
  assert.equal(Object.hasOwn(matched[0], 'lat'), false);
  assert.equal(Object.hasOwn(matched[0], 'lng'), false);
});

test('evidence hash-chain verifies and detects tampering; case file checks stored chunk bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fule-evidence-'));
  const rows = [];
  const store = {
    appendEvidence: async ({ build }) => { const row = build(rows.length + 1, rows.at(-1)?.chain_hash || '0'.repeat(64)); rows.push(row); return row; },
    listEvidence: async () => rows
  };
  try {
    const vault = new EvidenceVault({ directory, store });
    await vault.appendChunk('incident-1', Buffer.from('private-audio-1'), { contentType: 'audio/webm', recordedAt: '2026-11-04T10:00:00.000Z' });
    await vault.appendChunk('incident-1', Buffer.from('private-audio-2'), { contentType: 'audio/webm', recordedAt: '2026-11-04T10:00:10.000Z' });
    const encryptedStoredBytes = await readFile(join(directory, rows[0].storage_key));
    assert.notDeepEqual(encryptedStoredBytes, Buffer.from('private-audio-1'));
    assert.equal((await vault.readChunk(rows[0])).toString(), 'private-audio-1');
    assert.equal(verifyEvidenceChain(rows).valid, true);
    const bundle = await vault.createCaseFile({ incident_id: 'incident-1', created_at: '2026-11-04T10:00:00.000Z', location: { lat: 1, lng: 2, address: 'Guardian-only address' }, status: 'ACKNOWLEDGED', guardian_responses: [] });
    assert.equal(bundle.integrity.valid, true);
    assert.equal(bundle.integrity.files_valid, true);
    assert.equal(bundle.evidence.length, 2);
    const tampered = [{ ...rows[0], sha256: 'f'.repeat(64) }, rows[1]];
    assert.equal(verifyEvidenceChain(tampered).valid, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

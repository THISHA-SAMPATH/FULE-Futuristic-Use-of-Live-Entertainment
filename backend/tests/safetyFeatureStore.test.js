import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('demo safe-walk state is persisted and reloaded across a new module instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fule-safety-store-'));
  const previousDirectory = process.env.FULE_DATA_DIR;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.FULE_DATA_DIR = directory;
  process.env.DATABASE_URL = '';
  try {
    const first = await import(`../services/safetyFeatureStore.js?store=first-${Date.now()}`);
    const walk = { walk_id: 'walk-persist-1', streamer_id: 'streamer-1', status: 'AWAITING_CHECKIN', destination: 'Home', location_trail: [{ lat: 12.97, lng: 77.59, at: '2026-11-04T10:00:00.000Z' }], checkin_number: 2 };
    await first.safetyFeatureStore.create(walk, { safe_pin_hash: 'safe', duress_pin_hash: 'duress', session_token_hash: 'token' });
    const restarted = await import(`../services/safetyFeatureStore.js?store=second-${Date.now()}`);
    const stored = await restarted.safetyFeatureStore.get(walk.walk_id);
    assert.deepEqual(stored.walk, walk);
    assert.equal(stored.session_token_hash, 'token');

    const incidentId = 'nearby-cap-persisted-test';
    await restarted.safetyFeatureStore.saveNearbyOffers(incidentId, [
      { guardian_id: 'guardian-a', approximate_area: 'Central district' },
      { guardian_id: 'guardian-b', approximate_area: 'Central district' }
    ]);
    assert.deepEqual(await restarted.safetyFeatureStore.nearbyOfferStates(incidentId), [
      { guardian_id: 'guardian-a', accepted_at: null, approximate_area: 'Nearby area' },
      { guardian_id: 'guardian-b', accepted_at: null, approximate_area: 'Nearby area' }
    ]);
    assert.deepEqual(await restarted.safetyFeatureStore.acceptNearbyGuardian(incidentId, 'guardian-a', 1), { accepted: true, count: 1 });
    assert.deepEqual(await restarted.safetyFeatureStore.acceptNearbyGuardian(incidentId, 'guardian-b', 1), { accepted: false, count: 1 });
    assert.equal(await restarted.safetyFeatureStore.nearbyGuardianCount(incidentId), 1);
  } finally {
    if (previousDirectory === undefined) delete process.env.FULE_DATA_DIR; else process.env.FULE_DATA_DIR = previousDirectory;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
    await rm(directory, { recursive: true, force: true });
  }
});

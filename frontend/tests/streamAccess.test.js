import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFeaturedStream } from '../src/streamAccess.js';

test('selects the local seeded preview only in demo mode', () => {
  const demo = { id: 'seeded-preview', title: 'Local simulation' };
  assert.equal(selectFeaturedStream({ demoMode: true, demoStream: demo }), demo);
});

test('selects the active incident without exposing a stream URL', () => {
  const selected = selectFeaturedStream({ demoMode: false, incidents: [{ incident_id: 'inc-1', status: 'PENDING_DISPATCH', location: { address: 'North Loop' } }] });
  assert.equal(selected.id, 'inc-1');
  assert.equal(selected.stream_url, null);
  assert.equal(selected.region, 'North Loop');
});

test('has no production stream preview while no incident is active', () => {
  assert.equal(selectFeaturedStream({ demoMode: false, incidents: [] }), null);
});

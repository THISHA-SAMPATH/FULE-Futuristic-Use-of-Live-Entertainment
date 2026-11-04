import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGuardiansBySearch, filterStreamsByCategory } from '../src/communityFilters.js';
import { DEMO_GUARDIANS, DEMO_STREAMS } from '../src/demo/seedData.js';

test('Community Help only returns community-help streams', () => {
  const result = filterStreamsByCategory(DEMO_STREAMS, 'Community Help');
  assert.ok(result.length > 0);
  assert.ok(result.length < DEMO_STREAMS.length);
  assert.ok(result.every((stream) => /community|guardian|support|together|check-in|walk/i.test(`${stream.title} ${stream.streamer} ${stream.region}`)));
});

test('guardian search matches responder name and returns no unrelated profiles', () => {
  assert.deepEqual(filterGuardiansBySearch(DEMO_GUARDIANS, 'asha').map(({ id }) => id), ['guardian-1']);
  assert.deepEqual(filterGuardiansBySearch(DEMO_GUARDIANS, 'nobody'), []);
});

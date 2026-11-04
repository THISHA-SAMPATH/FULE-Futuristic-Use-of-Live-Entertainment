import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFeaturedStream, twitchPlayerUrl } from '../src/streamAccess.js';

const activeIncident = {
  incident_id: 'incident-1',
  status: 'DISPATCHING',
  stream_url: 'https://www.twitch.tv/testchannel',
  location: { address: 'North Quarter · approximate area' }
};

test('real Twitch stream is limited to verified guardians during an active incident', () => {
  const publicView = selectFeaturedStream({ role: 'public', incidents: [activeIncident] });
  const streamerView = selectFeaturedStream({ role: 'streamer', incidents: [activeIncident] });
  const inactiveView = selectFeaturedStream({ role: 'guardian', incidents: [{ ...activeIncident, status: 'CANCELLED' }] });
  const guardianView = selectFeaturedStream({ role: 'guardian', incidents: [activeIncident] });

  assert.equal(publicView, null);
  assert.equal(streamerView, null);
  assert.equal(inactiveView, null);
  assert.equal(guardianView.stream_url, activeIncident.stream_url);
  assert.equal(guardianView.activeIncident, true);
});

test('Twitch player URL uses the current host as its parent and rejects non-Twitch streams', () => {
  const player = new URL(twitchPlayerUrl(activeIncident.stream_url, 'fule.example.test'));
  assert.equal(player.origin, 'https://player.twitch.tv');
  assert.equal(player.searchParams.get('channel'), 'testchannel');
  assert.deepEqual(player.searchParams.getAll('parent'), ['fule.example.test']);
  assert.equal(twitchPlayerUrl('https://example.org/not-twitch', 'fule.example.test'), null);
});

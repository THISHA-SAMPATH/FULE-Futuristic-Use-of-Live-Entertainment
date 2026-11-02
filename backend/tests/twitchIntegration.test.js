import test from 'node:test';
import assert from 'node:assert/strict';
import { TwitchIntegration, isRepeatedTrigger } from '../services/twitchIntegration.js';

test('duplicate Twitch EventSub message IDs can be suppressed in a rolling window', () => {
  const seen = new Map();
  assert.equal(isRepeatedTrigger(seen, 'message-1', 1000), false);
  assert.equal(isRepeatedTrigger(seen, 'message-1', 1001), true);
  assert.equal(isRepeatedTrigger(seen, 'message-1', 12_000), false);
});

test('clip capture gracefully returns null without a logged in Twitch account', async () => {
  const twitch = new TwitchIntegration({ clientId: '', clientSecret: '' });
  assert.equal(await twitch.createClip('offline-or-demo'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSosClickHandler, DEMO_LOCATION, DEMO_STREAMER, submitSos } from '../src/sosFlow.js';

test('SOS button click handlers discard circular DOM events before the pipeline', () => {
  let args;
  const clickHandler = createSosClickHandler((...values) => { args = values; });
  const event = { target: { nodeName: 'BUTTON' }, currentTarget: { nodeName: 'BUTTON' } };
  event.self = event;
  clickHandler(event);
  assert.deepEqual(args, ['button', '']);
  assert.doesNotThrow(() => JSON.stringify({ source: args[0], transcript: args[1] }));
});

test('demo SOS uses synthetic identity and coordinates without Twitch or geolocation', async () => {
  const calls = [];
  const result = await submitSos({
    demoMode: true,
    user: null,
    geolocation: null,
    apiUrl: 'http://localhost:4000',
    source: 'redeem',
    transcript: 'Synthetic scenario transcript',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ incident: { incident_id: 'demo-test', status: 'PENDING_DISPATCH' }, streamer_cancel_token: 'cancel-token' }) };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://localhost:4000/api/sos');
  assert.equal(calls[0].body.streamer_id, DEMO_STREAMER.id);
  assert.deepEqual(calls[0].body.location, DEMO_LOCATION);
  assert.equal(calls[0].body.source, 'redeem');
  assert.equal(calls[0].body.audio_transcript_snippet, 'Synthetic scenario transcript');
  assert.equal(result.streamer.login, 'Demo Streamer');
});

test('production mode checks Twitch login before requesting geolocation', async () => {
  let geolocationRead = false;
  await assert.rejects(submitSos({
    demoMode: false, user: null, apiUrl: 'http://localhost:4000',
    geolocation: { getCurrentPosition() { geolocationRead = true; } },
    fetchImpl: async () => { throw new Error('fetch must not run'); }
  }), { code: 'TWITCH_LOGIN_REQUIRED', message: 'Connect your Twitch account before starting SOS.' });
  assert.equal(geolocationRead, false);
});

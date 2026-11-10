import test from 'node:test';
import assert from 'node:assert/strict';
import { TwitchIntegration, isRepeatedTrigger, OAUTH_SCOPES } from '../services/twitchIntegration.js';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

class MockWebSocket {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; MockWebSocket.instances.push(this); queueMicrotask(() => this.emit('open')); }
  addEventListener(name, listener) { const list = this.listeners.get(name) || []; list.push(listener); this.listeners.set(name, list); }
  emit(name, value = {}) { for (const listener of this.listeners.get(name) || []) listener(value); }
  message(body) { this.emit('message', { data: JSON.stringify(body) }); }
  close() { if (this.closed) return; this.closed = true; this.emit('close'); }
}

function notification(type, event, id) {
  return { metadata: { message_type: 'notification', subscription_type: type, message_id: id }, payload: { event } };
}

async function waitFor(assertion, timeoutMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.ok(assertion(), 'timed out waiting for Twitch mock operation');
}

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

test('OAuth URL uses one-time state and the least scopes needed for requested Twitch features', () => {
  const twitch = new TwitchIntegration({ clientId: 'client-id', clientSecret: 'server-secret', redirectUri: 'http://localhost/callback' });
  const state = twitch.createState();
  const url = new URL(twitch.loginUrl(state));
  assert.equal(url.origin, 'https://id.twitch.tv');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost/callback');
  assert.equal(url.searchParams.get('state'), state);
  assert.deepEqual(url.searchParams.get('scope').split(' '), OAUTH_SCOPES);
  assert.equal(twitch.consumeState(state, 'different-browser-state'), false);
  const secondState = twitch.createState();
  assert.equal(twitch.consumeState(secondState, secondState), true);
  assert.equal(twitch.consumeState(secondState, secondState), false);
});

test('OAuth exchanges code, stores tokens server-side, returns channel avatar, and provisions Silent SOS', async () => {
  const calls = [];
  const twitch = new TwitchIntegration({
    clientId: 'client-id', clientSecret: 'server-secret', redirectUri: 'http://localhost/callback',
    WebSocketImpl: MockWebSocket,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/oauth2/token')) return jsonResponse(200, { access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, scope: OAUTH_SCOPES });
      if (String(url).endsWith('/helix/users')) return jsonResponse(200, { data: [{ id: '123', login: 'testchannel', display_name: 'Test Channel', profile_image_url: 'https://static.test/avatar.png' }] });
      if (String(url).includes('/channel_points/custom_rewards?') && options.method !== 'POST') return jsonResponse(200, { data: [] });
      if (String(url).includes('/channel_points/custom_rewards?') && options.method === 'POST') return jsonResponse(200, { data: [{ id: 'reward-silent-sos', title: 'Silent SOS' }] });
      if (String(url).endsWith('/eventsub/subscriptions')) return jsonResponse(202, { data: [] });
      throw new Error(`Unexpected mocked Twitch API: ${url}`);
    }
  });

  const login = await twitch.finishLogin('authorization-code');
  await waitFor(() => twitch.accounts.get('123')?.rewardId === 'reward-silent-sos');
  assert.equal(login.user.login, 'testchannel');
  assert.equal(login.user.profile_image_url, 'https://static.test/avatar.png');
  assert.equal(JSON.stringify(login).includes('private-access'), false);
  assert.equal(JSON.stringify(login).includes('private-refresh'), false);
  assert.equal(twitch.accounts.get('123').accessToken, 'private-access');
  assert.equal(twitch.accounts.get('123').rewardId, 'reward-silent-sos');
  assert.equal(twitch.session(login.session).profile_image_url, login.user.profile_image_url);
  const tokenCall = calls.find((call) => call.url.endsWith('/oauth2/token'));
  assert.equal(tokenCall.options.method, 'POST');
  assert.equal(new URLSearchParams(tokenCall.options.body).get('code'), 'authorization-code');
  const rewardCreate = calls.find((call) => call.url.includes('/channel_points/custom_rewards?') && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(rewardCreate.options.body), {
    title: 'Silent SOS', cost: 1, prompt: 'Trigger a private safety alert to verified guardians.', is_enabled: true, is_user_input_required: false
  });

  const ws = MockWebSocket.instances.at(-1);
  ws.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-1' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.filter((call) => call.url.endsWith('/eventsub/subscriptions')).length, 2);
});

test('EventSub only accepts broadcaster chat commands, suppresses repeats, and routes Silent SOS redemptions', async () => {
  const sos = [];
  const safe = [];
  const twitch = new TwitchIntegration({
    clientId: 'client-id', clientSecret: 'secret', redirectUri: 'http://localhost/callback',
    WebSocketImpl: MockWebSocket,
    fetchImpl: async () => jsonResponse(202, { data: [] }),
    onSos: async (payload) => sos.push(payload),
    onSafe: async (id) => safe.push(id)
  });
  const account = { id: 'broadcaster-1', login: 'safechannel', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, scopes: OAUTH_SCOPES, rewardId: 'reward-1' };
  twitch.accounts.set(account.id, account);
  await twitch.connectEvents(account);
  const ws = MockWebSocket.instances.at(-1);
  ws.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 's' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const chat = (text, chatter = account.id) => ({ broadcaster_user_id: account.id, chatter_user_id: chatter, message: { text } });
  ws.message(notification('channel.chat.message', chat('!SOS'), 'chat-1'));
  ws.message(notification('channel.chat.message', chat('!SOS'), 'chat-1'));
  ws.message(notification('channel.chat.message', chat('!sos'), 'chat-2'));
  ws.message(notification('channel.chat.message', chat('!safe'), 'chat-3'));
  ws.message(notification('channel.chat.message', chat('!sos', 'spoofed-user'), 'chat-4'));
  ws.message(notification('channel.channel_points_custom_reward_redemption.add', {
    broadcaster_user_id: account.id, reward: { id: 'reward-1', title: 'Silent SOS' }
  }, 'redeem-1'));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sos.length, 2);
  assert.deepEqual(sos.map((item) => item.source), ['chat', 'redeem']);
  assert.equal(sos[0].streamer_id, account.id);
  assert.deepEqual(safe, [account.id]);
});

test('EventSub event ID claim suppresses duplicates across TwitchIntegration instances', async () => {
  const claimed = new Set(); const sos = [];
  const persistence = { async claimEventSubMessage(_streamerId, messageId) { if (claimed.has(messageId)) return false; claimed.add(messageId); return true; } };
  const make = () => new TwitchIntegration({ persistence, onSos: async (payload) => sos.push(payload), onSafe: async () => {} });
  const first = make(); const second = make();
  const account = { id: 'broadcaster-shared', login: 'test', rewardId: 'reward-1' };
  const message = notification('channel.channel_points_custom_reward_redemption.add', { broadcaster_user_id: account.id, reward: { id: 'reward-1', title: 'Silent SOS' } }, 'same-redemption-event');
  const socketMessage = { data: JSON.stringify(message) };
  await Promise.all([first.handleEventSubMessage({ account }, socketMessage), second.handleEventSubMessage({ account }, socketMessage)]);
  assert.equal(sos.length, 1); assert.equal(sos[0].source, 'redeem');
});

test('Twitch GET retries transient server errors through the shared resilience policy', async () => {
  let calls = 0;
  const twitch = new TwitchIntegration({
    clientId: 'client-id', clientSecret: 'secret', redirectUri: 'http://localhost/callback',
    sleepImpl: async () => {},
    fetchImpl: async () => { calls += 1; return calls < 3 ? jsonResponse(503, {}) : jsonResponse(200, { data: [{ id: 'ok' }] }); }
  });
  const response = await twitch.fetchWithDeadline('https://api.twitch.test/helix/users');
  assert.equal(response.status, 200); assert.equal(calls, 3);
});

test('EventSub reconnect handoff preserves subscriptions; unexpected close retries with backoff', async () => {
  MockWebSocket.instances = [];
  const states = [];
  const subscriptions = [];
  const twitch = new TwitchIntegration({
    clientId: 'client-id', clientSecret: 'secret', redirectUri: 'http://localhost/callback',
    WebSocketImpl: MockWebSocket, reconnectBaseMs: 5, reconnectMaxMs: 20,
    onConnectionState: (state) => states.push(state),
    fetchImpl: async (url) => { if (String(url).endsWith('/eventsub/subscriptions')) subscriptions.push(url); return jsonResponse(202, { data: [] }); }
  });
  const account = { id: 'broadcaster-2', login: 'channel', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, scopes: OAUTH_SCOPES, rewardId: 'reward-2' };
  twitch.accounts.set(account.id, account);
  await twitch.connectEvents(account);
  const original = MockWebSocket.instances[0];
  original.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'original-session' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  original.message({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://reconnect.twitch.test/ws' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const handoff = MockWebSocket.instances[1];
  assert.equal(handoff.url, 'wss://reconnect.twitch.test/ws');
  handoff.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'handoff-session' } } });
  assert.equal(original.closed, true);
  assert.equal(subscriptions.length, 2, 'successful session_reconnect must keep the old subscriptions');
  handoff.close();
  await new Promise((resolve) => setTimeout(resolve, 12));
  const retry = MockWebSocket.instances[2];
  assert.ok(retry);
  retry.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'retry-session' } } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(subscriptions.length, 4, 'a new session after unexpected close must resubscribe');
  retry.close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const secondRetry = MockWebSocket.instances[3];
  assert.ok(secondRetry, 'a second unexpected close should continue retrying');
  assert.deepEqual(states.filter((state) => state.status === 'reconnect_scheduled').map((state) => state.details), ['Attempt 1 in 5ms', 'Attempt 2 in 10ms']);
  twitch.disconnectAccount(account.id);
});

test('Helix 401 reactively refreshes and rotates the server-side tokens', async () => {
  const calls = [];
  const twitch = new TwitchIntegration({
    clientId: 'client-id', clientSecret: 'server-secret', redirectUri: 'http://localhost/callback',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/oauth2/token')) return jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: OAUTH_SCOPES });
      if (String(url).endsWith('/helix/users') && options.headers.Authorization === 'Bearer old-access') return jsonResponse(401, { message: 'expired' });
      if (String(url).endsWith('/helix/users') && options.headers.Authorization === 'Bearer new-access') return jsonResponse(200, { data: [{ id: '123' }] });
      throw new Error(`Unexpected mocked Twitch API: ${url}`);
    }
  });
  const account = { id: '123', accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() + 3_600_000, scopes: OAUTH_SCOPES };
  const response = await twitch.apiForAccount('/users', account);
  assert.equal(response.status, 200);
  assert.equal(account.accessToken, 'new-access');
  assert.equal(account.refreshToken, 'new-refresh');
  assert.equal(calls.filter((call) => call.url.endsWith('/helix/users')).length, 2);
  assert.equal(new URLSearchParams(calls[1].options.body).get('refresh_token'), 'old-refresh');
});

test('Create Clip polls for the published URL and returns null when the stream is offline', async () => {
  let clipPolls = 0;
  const twitch = new TwitchIntegration({
    clientId: 'client-id', clientSecret: 'secret', redirectUri: 'http://localhost/callback',
    clipPollMs: 1, clipWaitMs: 100,
    fetchImpl: async (url, options = {}) => {
      if (String(url).endsWith('/clips?broadcaster_id=live-id') && options.method === 'POST') return jsonResponse(202, { data: [{ id: 'clip-id', edit_url: 'https://clips.twitch.tv/edit/secret' }] });
      if (String(url).endsWith('/clips?id=clip-id')) {
        clipPolls += 1;
        return jsonResponse(200, { data: clipPolls < 2 ? [] : [{ id: 'clip-id', url: 'https://clips.twitch.tv/published-clip' }] });
      }
      if (String(url).endsWith('/clips?broadcaster_id=offline-id') && options.method === 'POST') return jsonResponse(404, { error: 'offline' });
      throw new Error(`Unexpected mocked Twitch API: ${url}`);
    }
  });
  for (const id of ['live-id', 'offline-id']) twitch.accounts.set(id, {
    id, login: id, accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3_600_000, scopes: OAUTH_SCOPES
  });
  assert.equal(await twitch.createClip('live-id'), 'https://clips.twitch.tv/published-clip');
  assert.equal(clipPolls, 2);
  assert.equal(await twitch.createClip('offline-id'), null);
});

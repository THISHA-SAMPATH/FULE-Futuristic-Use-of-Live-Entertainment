import { randomBytes } from 'node:crypto';

const API = 'https://api.twitch.tv/helix';
const AUTH = 'https://id.twitch.tv/oauth2';

export class TwitchIntegration {
  constructor({ clientId, clientSecret, redirectUri, onSos, onSafe, rewardId = '', fetchImpl = fetch, WebSocketImpl = WebSocket } = {}) {
    Object.assign(this, { clientId, clientSecret, redirectUri, onSos, onSafe, rewardId, fetchImpl, WebSocketImpl });
    this.states = new Map();
    this.sessions = new Map();
    this.accounts = new Map();
    this.seenEvents = new Map();
    this.connections = new Map();
  }

  configured() { return Boolean(this.clientId && this.clientSecret && this.redirectUri); }
  createState() { const state = randomBytes(24).toString('hex'); this.states.set(state, Date.now() + 10 * 60_000); return state; }
  consumeState(value) {
    const expires = this.states.get(value); this.states.delete(value);
    return Boolean(expires && expires > Date.now());
  }
  loginUrl(state) {
    const url = new URL(`${AUTH}/authorize`);
    for (const [key, value] of Object.entries({ client_id: this.clientId, redirect_uri: this.redirectUri, response_type: 'code', scope: 'user:read:chat channel:read:redemptions clips:edit', state })) url.searchParams.set(key, value);
    return url.toString();
  }
  async exchangeCode(code) {
    const response = await this.fetchImpl(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, code, grant_type: 'authorization_code', redirect_uri: this.redirectUri }) });
    if (!response.ok) throw new Error(`Twitch token exchange failed (${response.status})`);
    return response.json();
  }
  async api(path, token, options = {}) {
    return this.fetchImpl(`${API}${path}`, { ...options, headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  }
  async finishLogin(code) {
    const token = await this.exchangeCode(code);
    const who = await this.api('/users', token.access_token);
    const user = (await who.json()).data?.[0];
    if (!who.ok || !user) throw new Error('Unable to identify Twitch streamer');
    const session = randomBytes(32).toString('base64url');
    // Keep only Twitch identity and credentials required for chat, redemptions and clip capture; memory only.
    this.accounts.set(user.id, { id: user.id, login: user.login, displayName: user.display_name, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, scopes: token.scope || [] });
    this.sessions.set(session, user.id);
    try { await this.connectEvents(this.accounts.get(user.id)); }
    catch (error) { console.error('Could not start Twitch EventSub connection:', error.message); }
    return { session, user: { id: user.id, login: user.login, display_name: user.display_name } };
  }
  session(sessionId) { const id = this.sessions.get(sessionId); const account = id && this.accounts.get(id); return account ? { id: account.id, login: account.login, display_name: account.displayName } : null; }
  logout(sessionId) { const id = this.sessions.get(sessionId); this.sessions.delete(sessionId); if (id) { const ws = this.connections.get(id); ws?.close(); this.connections.delete(id); this.accounts.delete(id); } }
  async ensureToken(account) {
    if (account.expiresAt > Date.now() + 60_000) return account.accessToken;
    const response = await this.fetchImpl(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: 'refresh_token', refresh_token: account.refreshToken }) });
    if (!response.ok) throw new Error(`Twitch token refresh failed (${response.status})`);
    const next = await response.json(); Object.assign(account, { accessToken: next.access_token, refreshToken: next.refresh_token || account.refreshToken, expiresAt: Date.now() + next.expires_in * 1000 }); return account.accessToken;
  }
  async createClip(streamerId) {
    const account = this.accounts.get(streamerId); if (!account) return null;
    try {
      const token = await this.ensureToken(account);
      const response = await this.api(`/clips?broadcaster_id=${encodeURIComponent(streamerId)}`, token, { method: 'POST' });
      if (!response.ok) return null; // Offline, missing clips:edit, or Twitch API error never blocks SOS.
      const result = (await response.json()).data?.[0];
      return result?.edit_url ? result.edit_url.replace(/\/edit$/, '') : result?.id ? `https://clips.twitch.tv/${result.id}` : null;
    } catch { return null; }
  }
  async connectEvents(account, url = 'wss://eventsub.wss.twitch.tv/ws') {
    const ws = new this.WebSocketImpl(url); this.connections.set(account.id, ws);
    ws.addEventListener('message', async (message) => {
      let envelope; try { envelope = JSON.parse(message.data); } catch { return; }
      const { metadata = {}, payload = {} } = envelope;
      if (metadata.message_type === 'session_welcome') { try { await this.subscribe(account, payload.session.id); } catch (error) { console.error('Could not subscribe to Twitch EventSub:', error.message); } return; }
      if (metadata.message_type === 'session_reconnect') { this.connectEvents(account, payload.session.reconnect_url).catch((error) => console.error('Twitch EventSub reconnect failed:', error.message)); return; }
      if (metadata.message_type !== 'notification') return;
      const event = payload.event || {}; const messageId = metadata.message_id || event.id;
      if (messageId && isRepeatedTrigger(this.seenEvents, messageId)) return;
      if (this.seenEvents.size > 5000) this.seenEvents.delete(this.seenEvents.keys().next().value);
      if (metadata.subscription_type === 'channel.chat.message') {
        if (event.broadcaster_user_id !== account.id || event.chatter_user_id !== account.id || event.source_broadcaster_user_id) return;
        const command = String(event.message?.text || '').trim().toLowerCase();
        if (command === '!sos') await this.onSos({ streamer_id: account.id, source: 'chat', audio_transcript_snippet: 'Streamer activated SOS from verified Twitch chat.' });
        if (command === '!safe') await this.onSafe(account.id);
      }
      if (metadata.subscription_type === 'channel.channel_points_custom_reward_redemption.add') {
        if (event.broadcaster_user_id !== account.id || String(event.reward?.title || '').trim().toLowerCase() !== 'silent sos') return;
        if (this.rewardId && event.reward?.id !== this.rewardId) return;
        await this.onSos({ streamer_id: account.id, source: 'redeem', audio_transcript_snippet: 'Silent SOS channel point reward redeemed.' });
      }
    });
    ws.addEventListener('close', () => { if (this.connections.get(account.id) === ws) this.connections.delete(account.id); });
  }
  async subscribe(account, sessionId) {
    const token = await this.ensureToken(account);
    for (const [type, condition, version] of [
      ['channel.chat.message', { broadcaster_user_id: account.id, user_id: account.id }, '1'],
      ['channel.channel_points_custom_reward_redemption.add', { broadcaster_user_id: account.id }, '1']
    ]) {
      await this.api('/eventsub/subscriptions', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, version, condition, transport: { method: 'websocket', session_id: sessionId } }) });
    }
  }
}

export function isRepeatedTrigger(events, key, now = Date.now(), windowMs = 10_000) {
  const previous = events.get(key); if (previous && now - previous < windowMs) return true; events.set(key, now); return false;
}

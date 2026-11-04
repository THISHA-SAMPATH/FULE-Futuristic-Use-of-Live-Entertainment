import { randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';

const API = 'https://api.twitch.tv/helix';
const AUTH = 'https://id.twitch.tv/oauth2';
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const OAUTH_SCOPES = Object.freeze([
  'user:read:chat',
  'channel:read:redemptions',
  'channel:manage:redemptions',
  'clips:edit'
]);
const SILENT_SOS_TITLE = 'Silent SOS';

function responseError(response, operation) {
  return new Error(`Twitch ${operation} failed (${response.status})`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TwitchIntegration {
  constructor({
    clientId, clientSecret, redirectUri, onSos, onSafe, rewardId = '', rewardCost = 1,
    fetchImpl = fetch, WebSocketImpl = WebSocket, onConnectionState = () => {},
    sleepImpl = sleep, now = () => Date.now(), reconnectBaseMs = 1000,
    reconnectMaxMs = 60_000, clipWaitMs = 10_000, clipPollMs = 1000, persistence = null
  } = {}) {
    Object.assign(this, {
      clientId, clientSecret, redirectUri, onSos, onSafe, rewardId,
      rewardCost, fetchImpl, WebSocketImpl, onConnectionState, sleepImpl,
      now, reconnectBaseMs, reconnectMaxMs, clipWaitMs, clipPollMs
    });
    this.persistence = persistence;
    this.sessionSecret = process.env.JWT_ACCESS_SECRET || 'development-only-secret-change-this-before-production';
    this.states = new Map();
    this.sessions = new Map();
    this.accounts = new Map();
    this.seenEvents = new Map();
    this.connections = new Map();
    this.pendingConnections = new Map();
    this.reconnectAttempts = new Map();
    this.reconnectTimers = new Map();
    this.leaseTimers = new Map();
  }

  async hydrate() {
    if (!this.persistence?.durable) return;
    const accounts = await this.persistence.loadAccounts();
    for (const account of accounts) {
      account.refreshing = null;
      this.accounts.set(account.id, account);
      if (this.configured()) this.connectEvents(account).catch((error) => this.recordState(account.id, 'connection_start_failed', error.message));
    }
  }

  configured() { return Boolean(this.clientId && this.clientSecret && this.redirectUri); }

  createState() {
    const now = this.now();
    for (const [key, expiresAt] of this.states) if (expiresAt <= now) this.states.delete(key);
    if (this.states.size >= 10_000) throw new Error('Too many pending Twitch authorization attempts');
    const state = randomBytes(24).toString('hex');
    this.states.set(state, now + 10 * 60_000);
    return state;
  }

  async createLoginState() {
    if (!this.persistence?.durable) return this.createState();
    const state = randomBytes(24).toString('hex');
    if (!await this.persistence.saveOAuthState(state)) throw new Error('Unable to store Twitch authorization state.');
    return state;
  }

  consumeState(value, browserBinding) {
    const expires = this.states.get(value);
    this.states.delete(value);
    if (!expires || expires <= this.now() || typeof value !== 'string' || typeof browserBinding !== 'string') return false;
    const candidate = Buffer.from(value);
    const expected = Buffer.from(browserBinding);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  async consumeLoginState(value, browserBinding) {
    if (!this.persistence?.durable) return this.consumeState(value, browserBinding);
    let consumed = false;
    try { consumed = await this.persistence.consumeOAuthState(String(value || '')); } catch { return false; }
    if (!consumed || typeof value !== 'string' || typeof browserBinding !== 'string') return false;
    const candidate = Buffer.from(value); const expected = Buffer.from(browserBinding);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  loginUrl(state) {
    const url = new URL(`${AUTH}/authorize`);
    for (const [key, value] of Object.entries({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES.join(' '),
      state
    })) url.searchParams.set(key, value);
    return url.toString();
  }

  async fetchWithDeadline(url, options = {}, deadline = this.now() + 15_000) {
    const remaining = Math.max(0, deadline - this.now());
    if (!remaining) throw new Error('Twitch request deadline exceeded');
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        this.fetchImpl(url, { ...options, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Twitch request deadline exceeded'));
          }, remaining);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async exchangeCode(code) {
    const response = await this.fetchWithDeadline(`${AUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri
      })
    });
    if (!response.ok) throw responseError(response, 'token exchange');
    return response.json();
  }

  async api(path, token, options = {}, deadline = this.now() + 15_000) {
    return this.fetchWithDeadline(`${API}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Client-Id': this.clientId,
        Authorization: `Bearer ${token}`
      }
    }, deadline);
  }

  async finishLogin(code) {
    const token = await this.exchangeCode(code);
    const who = await this.api('/users', token.access_token);
    if (!who.ok) throw responseError(who, 'profile lookup');
    const user = (await who.json()).data?.[0];
    if (!user) throw new Error('Unable to identify Twitch streamer');

    const accountData = {
      id: user.id,
      login: user.login,
      displayName: user.display_name || user.login,
      avatarUrl: user.profile_image_url || null,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: this.now() + Number(token.expires_in || 0) * 1000,
      scopes: Array.isArray(token.scope) ? token.scope : [],
      rewardId: this.rewardId || null
    };
    const existingAccount = this.accounts.get(user.id);
    const account = existingAccount ? Object.assign(existingAccount, accountData) : accountData;
    account.refreshing ??= null;
    account.authVersion ??= 0;
    await this.persistence?.saveAccount(account);
    this.accounts.set(user.id, account);
    const session = this.persistence?.durable
      ? jwt.sign({ sub: user.id, ver: account.authVersion, kind: 'twitch' }, this.sessionSecret, { expiresIn: '10m', issuer: 'fule' })
      : randomBytes(32).toString('base64url');
    if (!this.persistence?.durable) this.sessions.set(session, { userId: user.id, expiresAt: this.now() + 7 * 24 * 60 * 60 * 1000 });

    if (!this.connections.has(user.id) && !this.pendingConnections.has(user.id)) {
      this.connectEvents(account).catch((error) => this.recordState(user.id, 'connection_start_failed', error.message));
    } else this.recordState(user.id, 'session_refreshed', 'OAuth session refreshed without opening a duplicate EventSub connection');
    this.ensureSilentSosReward(account).catch((error) => this.recordState(user.id, 'reward_setup_failed', error.message));
    return {
      session,
      user: { id: account.id, login: account.login, display_name: account.displayName, profile_image_url: account.avatarUrl }
    };
  }

  session(sessionId) {
    let userId;
    if (this.persistence?.durable) {
      try { const payload = jwt.verify(String(sessionId || ''), this.sessionSecret, { issuer: 'fule' }); if (payload.kind !== 'twitch') return null; userId = payload.sub; }
      catch { return null; }
    } else {
      const stored = this.sessions.get(sessionId);
      if (!stored || stored.expiresAt <= this.now()) { this.sessions.delete(sessionId); return null; }
      userId = stored.userId;
    }
    const account = this.accounts.get(userId);
    if (this.persistence?.durable) {
      try { const payload = jwt.verify(String(sessionId || ''), this.sessionSecret, { issuer: 'fule' }); if (payload.ver !== (account?.authVersion || 0)) return null; }
      catch { return null; }
    }
    return account ? {
      id: account.id,
      login: account.login,
      display_name: account.displayName,
      profile_image_url: account.avatarUrl
    } : null;
  }

  async sessionAsync(sessionId) {
    if (!this.persistence?.durable) return this.session(sessionId);
    let payload;
    try { payload = jwt.verify(String(sessionId || ''), this.sessionSecret, { issuer: 'fule' }); }
    catch { return null; }
    if (payload.kind !== 'twitch' || typeof payload.sub !== 'string') return null;
    const stored = await this.persistence.loadAccount(payload.sub);
    if (!stored || payload.ver !== (stored.authVersion || 0)) return null;
    stored.refreshing = null;
    this.accounts.set(stored.id, stored);
    return this.session(sessionId);
  }

  async logout(sessionId) {
    if (this.persistence?.durable) {
      try {
        const payload = jwt.verify(String(sessionId || ''), this.sessionSecret, { issuer: 'fule' });
        if (payload.kind !== 'twitch') return;
        this.disconnectAccount(payload.sub);
        await this.persistence.removeAccount(payload.sub);
      } catch { /* Expired or invalid session is already logged out. */ }
      return;
    }
    const stored = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (!stored) return;
    const hasOtherSession = [...this.sessions.values()].some((session) => session.userId === stored.userId && session.expiresAt > this.now());
    if (!hasOtherSession) this.disconnectAccount(stored.userId);
  }

  disconnectAccount(userId) {
    const leaseTimer = this.leaseTimers.get(userId);
    if (leaseTimer) clearInterval(leaseTimer);
    this.leaseTimers.delete(userId);
    if (this.persistence?.durable) void this.persistence.releaseEventSub(userId);
    const connection = this.connections.get(userId);
    if (connection) {
      connection.intentional = true;
      connection.ws.close();
      this.connections.delete(userId);
    }
    const pending = this.pendingConnections.get(userId);
    if (pending) {
      pending.intentional = true;
      pending.ws.close();
      this.pendingConnections.delete(userId);
    }
    const timer = this.reconnectTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(userId);
    this.reconnectAttempts.delete(userId);
    this.accounts.delete(userId);
    this.recordState(userId, 'disconnected', 'Streamer logged out');
  }

  async shutdown() {
    const ids = [...this.accounts.keys()];
    for (const id of ids) {
      for (const connection of [this.connections.get(id), this.pendingConnections.get(id)]) {
        if (connection) { connection.intentional = true; connection.ws.close(); }
      }
      const timer = this.leaseTimers.get(id);
      if (timer) clearInterval(timer);
    }
    this.connections.clear(); this.pendingConnections.clear(); this.leaseTimers.clear();
    if (this.persistence?.durable) await this.persistence.releaseAllEventSub(ids);
  }

  recordState(userId, status, details = '') {
    try { this.onConnectionState({ user_id: userId, status, details }); }
    catch (error) { console.error('Could not record Twitch connection state:', error.message); }
  }

  async refreshToken(account, force = false, deadline = this.now() + 15_000) {
    if (!force && account.expiresAt > this.now() + 60_000) return account.accessToken;
    if (account.refreshing) return account.refreshing;
    account.refreshing = (async () => {
      const response = await this.fetchWithDeadline(`${AUTH}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: account.refreshToken
        })
      }, deadline);
      if (!response.ok) throw responseError(response, 'token refresh');
      const next = await response.json();
      Object.assign(account, {
        accessToken: next.access_token,
        refreshToken: next.refresh_token || account.refreshToken,
        expiresAt: this.now() + Number(next.expires_in || 0) * 1000,
        scopes: Array.isArray(next.scope) ? next.scope : account.scopes
      });
      await this.persistence?.saveAccount(account);
      return account.accessToken;
    })().finally(() => { account.refreshing = null; });
    return account.refreshing;
  }

  async apiForAccount(path, account, options = {}, deadline = this.now() + 15_000) {
    let token = await this.refreshToken(account, false, deadline);
    let response = await this.api(path, token, options, deadline);
    if (response.status === 401) {
      token = await this.refreshToken(account, true, deadline);
      response = await this.api(path, token, options, deadline);
    }
    return response;
  }

  async ensureSilentSosReward(account) {
    const query = new URLSearchParams({ broadcaster_id: account.id });
    const list = await this.apiForAccount(`/channel_points/custom_rewards?${query}`, account);
    if (!list.ok) throw responseError(list, 'reward lookup');
    const rewards = (await list.json()).data || [];
    const existing = rewards.find((reward) => reward.id === this.rewardId)
      || rewards.find((reward) => String(reward.title || '').trim().toLowerCase() === SILENT_SOS_TITLE.toLowerCase());
    if (existing) {
      account.rewardId = existing.id;
      await this.persistence?.saveAccount(account);
      return existing.id;
    }

    const created = await this.apiForAccount(`/channel_points/custom_rewards?${query}`, account, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: SILENT_SOS_TITLE,
        cost: Math.max(1, Number(this.rewardCost) || 1),
        prompt: 'Trigger a private safety alert to verified guardians.',
        is_enabled: true,
        is_user_input_required: false
      })
    });
    if (!created.ok) throw responseError(created, 'reward creation');
    const reward = (await created.json()).data?.[0];
    if (!reward?.id) throw new Error('Twitch created the reward without returning its ID');
    account.rewardId = reward.id;
    await this.persistence?.saveAccount(account);
    return reward.id;
  }

  async createClip(streamerId) {
    const account = this.accounts.get(streamerId);
    if (!account) return null;
    const deadline = this.now() + this.clipWaitMs;
    try {
      const createQuery = new URLSearchParams({ broadcaster_id: streamerId });
      const createdResponse = await this.apiForAccount(`/clips?${createQuery}`, account, { method: 'POST' }, deadline);
      if (createdResponse.status !== 202 && !createdResponse.ok) return null;
      const clipId = (await createdResponse.json()).data?.[0]?.id;
      if (!clipId) return null;

      while (this.now() < deadline) {
        const query = new URLSearchParams({ id: clipId });
        const response = await this.apiForAccount(`/clips?${query}`, account, {}, deadline);
        if (!response.ok) return null;
        const clip = (await response.json()).data?.[0];
        if (clip?.url) return clip.url;
        if (clip?.id && clip?.embed_url) return `https://clips.twitch.tv/${encodeURIComponent(clip.id)}`;
        if (this.now() >= deadline) break;
        await this.sleepImpl(Math.min(this.clipPollMs, deadline - this.now()));
      }
    } catch { /* Offline channels and API failures never block an SOS. */ }
    return null;
  }

  startLeaseRenewal(account) {
    if (!this.persistence?.durable || this.leaseTimers.has(account.id)) return;
    const timer = setInterval(async () => {
      try {
        if (await this.persistence.renewEventSub(account.id)) return;
        clearInterval(timer); this.leaseTimers.delete(account.id);
        for (const connection of [this.connections.get(account.id), this.pendingConnections.get(account.id)]) {
          if (connection) { connection.intentional = true; connection.ws.close(); }
        }
        this.connections.delete(account.id); this.pendingConnections.delete(account.id);
        this.recordState(account.id, 'eventsub_lease_lost', 'EventSub ownership moved to another instance');
        this.scheduleReconnect(account);
      } catch (error) {
        clearInterval(timer); this.leaseTimers.delete(account.id);
        for (const connection of [this.connections.get(account.id), this.pendingConnections.get(account.id)]) {
          if (connection) { connection.intentional = true; connection.ws.close(); }
        }
        this.connections.delete(account.id); this.pendingConnections.delete(account.id);
        this.recordState(account.id, 'eventsub_lease_renew_failed', error.message);
        this.scheduleReconnect(account);
      }
    }, 10_000);
    timer.unref?.();
    this.leaseTimers.set(account.id, timer);
  }

  async connectEvents(account, url = EVENTSUB_URL, { handoff = false, previous = null } = {}) {
    if (this.persistence?.durable) {
      let owns = await this.persistence.ownsEventSub(account.id);
      if (!owns) owns = await this.persistence.claimEventSub(account.id);
      if (!owns) { this.recordState(account.id, 'eventsub_owned_by_peer', 'Another API instance owns this broadcaster EventSub connection'); this.scheduleReconnect(account); return null; }
      this.startLeaseRenewal(account);
    }
    let ws;
    try { ws = new this.WebSocketImpl(url); }
    catch (error) {
      if (!handoff) this.scheduleReconnect(account);
      throw error;
    }
    const connection = { ws, account, handoff, previous, intentional: false, ready: false };
    if (handoff) this.pendingConnections.set(account.id, connection);
    else this.connections.set(account.id, connection);
    this.recordState(account.id, handoff ? 'session_reconnecting' : 'connecting', handoff ? 'Twitch session_reconnect requested' : 'Opening EventSub WebSocket');

    ws.addEventListener('open', () => this.recordState(account.id, 'socket_open', 'EventSub WebSocket opened'));
    ws.addEventListener('message', (message) => {
      this.handleEventSubMessage(connection, message).catch((error) => this.recordState(account.id, 'event_processing_failed', error.message));
    });
    ws.addEventListener('error', () => this.recordState(account.id, 'socket_error', 'EventSub WebSocket error'));
    ws.addEventListener('close', () => this.handleSocketClose(connection));
    return connection;
  }

  async handleEventSubMessage(connection, message) {
    let envelope;
    try { envelope = JSON.parse(typeof message.data === 'string' ? message.data : String(message.data)); }
    catch { return; }
    const { metadata = {}, payload = {} } = envelope;
    const { account } = connection;

    if (metadata.message_type === 'session_welcome') {
      if (connection.handoff) {
        connection.ready = true;
        this.pendingConnections.delete(account.id);
        const old = connection.previous;
        this.connections.set(account.id, connection);
        this.markConnectionStable(connection);
        this.recordState(account.id, 'connected', 'EventSub session handoff completed');
        if (old) {
          old.intentional = true;
          old.ws.close();
        }
        return;
      }
      try {
        await this.subscribe(account, payload.session.id);
        connection.ready = true;
        this.markConnectionStable(connection);
        this.recordState(account.id, 'connected', 'EventSub subscriptions enabled');
      } catch (error) {
        this.recordState(account.id, 'subscription_failed', error.message);
      }
      return;
    }

    if (metadata.message_type === 'session_reconnect') {
      const reconnectUrl = payload.session?.reconnect_url;
      if (typeof reconnectUrl !== 'string' || !reconnectUrl.startsWith('wss://')) {
        this.recordState(account.id, 'reconnect_invalid', 'Twitch supplied an invalid reconnect URL');
        return;
      }
      if (this.pendingConnections.has(account.id)) return;
      this.connectEvents(account, reconnectUrl, { handoff: true, previous: connection })
        .catch((error) => this.recordState(account.id, 'handoff_failed', error.message));
      return;
    }

    if (metadata.message_type !== 'notification') return;
    const event = payload.event || {};
    const messageId = metadata.message_id || event.id;
    if (messageId && isRepeatedTrigger(this.seenEvents, `event:${account.id}:${messageId}`)) return;
    this.pruneSeenEvents();

    if (metadata.subscription_type === 'channel.chat.message') {
      if (event.broadcaster_user_id !== account.id || event.chatter_user_id !== account.id || event.source_broadcaster_user_id) return;
      const command = String(event.message?.text || '').trim().toLowerCase();
      if (!['!sos', '!safe'].includes(command)) return;
      if (isRepeatedTrigger(this.seenEvents, `chat:${account.id}:${command}`, this.now(), 10_000)) return;
      try {
        if (command === '!sos') await this.onSos?.({ streamer_id: account.id, source: 'chat', audio_transcript_snippet: 'Streamer activated SOS from verified Twitch chat.' });
        else await this.onSafe?.(account.id);
      } catch (error) { this.recordState(account.id, 'chat_command_failed', error.message); }
      return;
    }

    if (metadata.subscription_type === 'channel.channel_points_custom_reward_redemption.add') {
      if (event.broadcaster_user_id !== account.id || String(event.reward?.title || '').trim().toLowerCase() !== SILENT_SOS_TITLE.toLowerCase()) return;
      if (account.rewardId && event.reward?.id !== account.rewardId) return;
      try {
        await this.onSos?.({ streamer_id: account.id, source: 'redeem', audio_transcript_snippet: 'Silent SOS channel point reward redeemed.' });
      } catch (error) { this.recordState(account.id, 'redemption_failed', error.message); }
    }
  }

  pruneSeenEvents() {
    const cutoff = this.now() - 10 * 60_000;
    for (const [key, timestamp] of this.seenEvents) if (timestamp < cutoff) this.seenEvents.delete(key);
    while (this.seenEvents.size > 5000) this.seenEvents.delete(this.seenEvents.keys().next().value);
  }

  markConnectionStable(connection) {
    clearTimeout(connection.stableTimer);
    connection.stableTimer = setTimeout(() => {
      if (this.connections.get(connection.account.id) === connection) this.reconnectAttempts.delete(connection.account.id);
    }, 60_000);
    connection.stableTimer.unref?.();
  }

  handleSocketClose(connection) {
    const { account } = connection;
    clearTimeout(connection.stableTimer);
    if (this.pendingConnections.get(account.id) === connection) this.pendingConnections.delete(account.id);
    if (connection.intentional) return;
    const isCurrent = this.connections.get(account.id) === connection;
    const previousStillCurrent = connection.handoff && this.connections.get(account.id) === connection.previous;
    if (!isCurrent && !previousStillCurrent) return;
    this.recordState(account.id, 'socket_closed', 'EventSub WebSocket closed');
    if (isCurrent) this.connections.delete(account.id);
    if (this.accounts.get(account.id) === account && !previousStillCurrent) this.scheduleReconnect(account);
  }

  scheduleReconnect(account) {
    if (this.reconnectTimers.has(account.id) || this.accounts.get(account.id) !== account) return;
    const attempt = (this.reconnectAttempts.get(account.id) || 0) + 1;
    this.reconnectAttempts.set(account.id, attempt);
    const delay = Math.min(this.reconnectBaseMs * (2 ** Math.min(attempt - 1, 10)), this.reconnectMaxMs);
    this.recordState(account.id, 'reconnect_scheduled', `Attempt ${attempt} in ${delay}ms`);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(account.id);
      if (this.accounts.get(account.id) !== account) return;
      this.connectEvents(account).catch((error) => {
        this.recordState(account.id, 'reconnect_failed', error.message);
        this.scheduleReconnect(account);
      });
    }, delay);
    timer.unref?.();
    this.reconnectTimers.set(account.id, timer);
  }

  async subscribe(account, sessionId) {
    const subscriptions = [
      ['channel.chat.message', { broadcaster_user_id: account.id, user_id: account.id }],
      ['channel.channel_points_custom_reward_redemption.add', {
        broadcaster_user_id: account.id,
        ...(account.rewardId ? { reward_id: account.rewardId } : {})
      }]
    ];
    for (const [type, condition] of subscriptions) {
      const response = await this.apiForAccount('/eventsub/subscriptions', account, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, version: '1', condition, transport: { method: 'websocket', session_id: sessionId } })
      });
      if (!response.ok) throw responseError(response, `EventSub ${type} subscription`);
    }
  }
}

export function isRepeatedTrigger(events, key, now = Date.now(), windowMs = 10_000) {
  const previous = events.get(key);
  if (previous && now - previous < windowMs) return true;
  events.set(key, now);
  return false;
}

export { OAUTH_SCOPES, SILENT_SOS_TITLE };

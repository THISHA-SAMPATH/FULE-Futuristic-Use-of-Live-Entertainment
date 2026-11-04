import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { INCIDENT_MODULE, createIncident, isIncident, toPublicIncident } from '../shared/incident.mjs';
import { authenticateGuardian, seedDemoInvite, verifyGuardianInvite } from './services/guardianRegistry.js';
import { writeAudit } from './services/auditLog.js';
import { deterministicFallback, synthesizeIncident } from './services/incidentSynthesizer.js';
import { createStreamerRateLimiter, validateSosPayload } from './services/sosValidation.js';
import { TwitchIntegration } from './services/twitchIntegration.js';
import { loadIncidents, persistIncident, removeIncident } from './services/incidentStore.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const app = express();
const httpServer = http.createServer(app);
httpServer.requestTimeout = 15_000;
httpServer.headersTimeout = 20_000;
httpServer.keepAliveTimeout = 5_000;
httpServer.maxRequestsPerSocket = 1_000;
const port = Number(process.env.PORT) || 4000;
const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const demoMode = process.env.DEMO_MODE === 'true';
const parsedAllowedOrigin = new URL(allowedOrigin);
if (!['http:', 'https:'].includes(parsedAllowedOrigin.protocol) || parsedAllowedOrigin.origin !== allowedOrigin) {
  throw new Error('FRONTEND_ORIGIN must be a single HTTP(S) origin without a path.');
}
if (!demoMode && parsedAllowedOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsedAllowedOrigin.hostname)) {
  throw new Error('Non-demo deployments must use an HTTPS FRONTEND_ORIGIN.');
}
if (demoMode) seedDemoInvite(process.env.FULE_DEMO_GUARDIAN_INVITE);

const io = new Server(httpServer, {
  cors: { origin: allowedOrigin, methods: ['GET', 'POST'], credentials: true },
  maxHttpBufferSize: 64 * 1024,
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    callback(null, !origin || origin === allowedOrigin);
  }
});
const rateLimitSos = createStreamerRateLimiter({ limit: 3, windowMs: 5 * 60 * 1000 });
const incidents = new Map(loadIncidents().map((incident) => [incident.incident_id, incident]));
const cancelCredentials = new Map();
const timers = new Map();
const inviteAttempts = new Map();
const streamerLocations = new Map();
const sessionCookie = 'fule_twitch_session';
const oauthStateCookie = 'fule_twitch_oauth_state';
const sessionCookieSameSite = parsedAllowedOrigin.protocol === 'https:' ? 'none' : 'lax';
const requestBuckets = new Map();
const creatingIncidents = new Set();
const socketConnectionsByIp = new Map();
const socketAttemptsByIp = new Map();

app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(cors({
  origin(origin, callback) {
    return callback(null, !origin || origin === allowedOrigin);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600
}));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin'
  });
  if (req.secure || parsedAllowedOrigin.protocol === 'https:') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '32kb', strict: true, type: 'application/json' }));

function enforceRequestSafety(req, res, next) {
  const origin = req.get('Origin');
  if (origin && origin !== allowedOrigin) return res.status(403).json({ error: 'Request origin is not allowed.' });
  if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return res.status(415).json({ error: 'Requests must use application/json.' });
  }
  next();
}

function requestLimit({ limit, windowMs }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${req.baseUrl}${req.path}`;
    const bucket = requestBuckets.get(key) || { startedAt: now, count: 0 };
    if (now - bucket.startedAt >= windowMs) { bucket.startedAt = now; bucket.count = 0; }
    bucket.count += 1; requestBuckets.set(key, bucket);
    if (bucket.count > limit) {
      res.set('Retry-After', String(Math.ceil((bucket.startedAt + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'Request rate limit exceeded.' });
    }
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    if (requestBuckets.size > 10_000) {
      for (const [bucketKey, value] of requestBuckets) if (now - value.startedAt >= windowMs) requestBuckets.delete(bucketKey);
    }
    next();
  };
}

app.use(enforceRequestSafety);
app.use('/api', requestLimit({ limit: 180, windowMs: 60_000 }));
app.use('/auth', requestLimit({ limit: 30, windowMs: 60_000 }));

function hashToken(value) {
  return createHash('sha256').update(value).digest();
}

function tokenMatches(token, expectedHex) {
  if (typeof token !== 'string' || !expectedHex) return false;
  const actual = hashToken(token);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getBearerToken(request) {
  const [scheme, token] = String(request.headers.authorization || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : '';
}

function getGuardian(request) {
  return authenticateGuardian(getBearerToken(request));
}

function getTwitchUser(req) {
  const cookie = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${sessionCookie}=`));
  if (!cookie) return null;
  try { return twitch.session(decodeURIComponent(cookie.slice(sessionCookie.length + 1))); }
  catch { return null; }
}

function getCookie(req, name) {
  const pair = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)); }
  catch { return null; }
}

function isLoopbackRequest(req) {
  const address = String(req.socket.remoteAddress || req.ip || '').toLowerCase();
  return address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.') || address === 'localhost';
}

function writeStateChange({ incident, event, fromStatus, toStatus, actorId, details }) {
  writeAudit({
    event,
    incident_id: incident.incident_id,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: actorId || null,
    details: details || null
  });
}

function publishPublicUpdate(incident) {
  io.to('public').emit('incident:public:update', {
    incident_id: incident.incident_id,
    status: incident.status,
    created_at: incident.created_at,
    escalated: incident.escalated,
    escalation_flag: incident.escalation_flag
  });
}

function clearIncidentTimers(incidentId) {
  const scheduled = timers.get(incidentId);
  if (scheduled) {
    clearTimeout(scheduled.dispatch);
    clearTimeout(scheduled.escalation);
    timers.delete(incidentId);
  }
}

function changeIncident(incidentId, patch, { event, actorId, details } = {}) {
  const current = incidents.get(incidentId);
  if (!current) return null;
  const updated = createIncident({ ...current, ...patch });
  if (!isIncident(updated)) throw new Error('Incident state failed schema validation');
  writeStateChange({
    incident: updated,
    event,
    fromStatus: current.status,
    toStatus: updated.status,
    actorId,
    details
  });
  incidents.set(incidentId, updated);
  persistIncident(updated);
  return updated;
}

async function createSosIncident(input) {
  const validated = validateSosPayload(input);
  if (!validated.ok) return { status: 400, body: { error: validated.error } };
  const payload = validated.value;
  const limit = rateLimitSos(payload.streamer_id);
  if (!limit.allowed) return { status: 429, body: { error: 'SOS rate limit reached. Maximum 3 activations per streamer every 5 minutes.' } };
  if ([...incidents.values()].some((item) => item.streamer_id === payload.streamer_id && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(item.status))) {
    return { status: 409, body: { error: 'An active incident already exists for this streamer.' } };
  }
  if (creatingIncidents.has(payload.streamer_id)) return { status: 409, body: { error: 'An SOS is already being processed for this streamer.' } };
  if (incidents.size >= 2_000) {
    const terminal = [...incidents.entries()].find(([, item]) => ['ACKNOWLEDGED', 'CANCELLED', 'FALSE_ALARM', 'RESOLVED'].includes(item.status));
    if (terminal) { incidents.delete(terminal[0]); removeIncident(terminal[0]); }
    else return { status: 503, body: { error: 'Incident capacity is temporarily full.' } };
  }
  creatingIncidents.add(payload.streamer_id);
  try {
  const activatedAt = Date.now();
  const synthesisInput = {
    audio_transcript_snippet: payload.audio_transcript_snippet,
    module_type: payload.module_type,
    source: payload.source,
    location: {
      lat: Number.isFinite(payload.location.lat) ? Math.round(payload.location.lat * 100) / 100 : null,
      lng: Number.isFinite(payload.location.lng) ? Math.round(payload.location.lng * 100) / 100 : null
    }
  };
  const synthesis = deterministicFallback(synthesisInput);
  const twitchAccount = twitch.accounts.get(payload.streamer_id);
  const incident = createIncident({
    incident_id: `sos-${activatedAt}-${randomBytes(4).toString('hex')}`, threat_level: synthesis.threat_level,
    module: payload.module_type, location: payload.location, summary: synthesis.summary,
    recommended_action: synthesis.recommended_action, status: 'PENDING_DISPATCH', created_at: new Date(activatedAt).toISOString(),
    source: payload.source, stream_url: twitchAccount ? `https://www.twitch.tv/${twitchAccount.login}` : null
  });
  if (!isIncident(incident)) return { status: 500, body: { error: 'Incident failed schema validation.' } };
  const cancelToken = randomBytes(32).toString('base64url');
  const graceDelayMs = Number(process.env.FULE_DISPATCH_GRACE_MS) || 10_000;
  const escalationDelayMs = Number(process.env.FULE_ESCALATION_DELAY_MS) || 30_000;
  writeStateChange({ incident, event: 'SOS_CREATED', fromStatus: null, toStatus: incident.status, actorId: payload.streamer_id });
  incidents.set(incident.incident_id, { ...incident, streamer_id: payload.streamer_id });
  persistIncident(incidents.get(incident.incident_id));
  cancelCredentials.set(incident.incident_id, { streamer_id: payload.streamer_id, token_hash: hashToken(cancelToken).toString('hex'), dispatch_ready_at: activatedAt + graceDelayMs });
  io.to('guardians').emit('sos_activated', { ...incident, grace_period_seconds: 10 });
  io.to('public').emit('incident:public', toPublicIncident(incident));
  scheduleDispatch(incident, { graceDelayMs, escalationDelayMs });
  void synthesizeIncident(synthesisInput).then((aiResult) => {
    if (!incidents.has(incident.incident_id)) return;
    const updated = changeIncident(incident.incident_id, aiResult, { event: 'AI_SYNTHESIS_UPDATED', actorId: 'system' });
    io.to('guardians').emit('incident_updated', updated);
    io.to(`streamer:${incident.incident_id}`).emit('incident_updated', updated);
    publishPublicUpdate(updated);
  }).catch((error) => console.error('Incident synthesis update failed:', error.message));
  void twitch.createClip(payload.streamer_id).then((clipUrl) => {
    if (!clipUrl) return;
    const current = incidents.get(incident.incident_id); if (!current) return;
    const updated = changeIncident(incident.incident_id, { clip_url: clipUrl }, { event: 'CLIP_ATTACHED', actorId: payload.streamer_id, details: 'Twitch clip captured after SOS activation' });
    io.to('guardians').emit('incident_clip_ready', updated);
  });
  return { status: 201, body: { incident, streamer_cancel_token: cancelToken } };
  } finally {
    creatingIncidents.delete(payload.streamer_id);
  }
}

async function markStreamerSafe(streamerId) {
  const current = [...incidents.values()].find((item) => item.streamer_id === streamerId && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(item.status));
  if (!current) return false;
  const credentials = cancelCredentials.get(current.incident_id);
  if (current.status !== 'PENDING_DISPATCH' || !credentials || Date.now() > credentials.dispatch_ready_at) return false;
  clearIncidentTimers(current.incident_id);
  const cancelled = changeIncident(current.incident_id, { status: 'FALSE_ALARM' }, { event: 'CHAT_SAFE_FALSE_ALARM', actorId: streamerId });
  cancelCredentials.delete(current.incident_id);
  io.to('guardians').emit('sos_cancelled', cancelled); publishPublicUpdate(cancelled); return true;
}

const twitch = new TwitchIntegration({
  clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET,
  redirectUri: process.env.TWITCH_REDIRECT_URI || 'http://localhost:4000/auth/twitch/callback',
  rewardId: process.env.TWITCH_SILENT_SOS_REWARD_ID || '',
  rewardCost: process.env.TWITCH_SILENT_SOS_COST || 1,
  onConnectionState: ({ user_id, status, details }) => writeAudit({
    event: 'TWITCH_EVENTSUB_CONNECTION_STATE', actor_id: user_id, details: `${status}: ${details}`
  }),
  onSos: async ({ streamer_id, source, audio_transcript_snippet }) => {
    const savedLocation = streamerLocations.get(streamer_id);
    const location = savedLocation && Date.now() - savedLocation.updatedAt < 10 * 60_000
      ? savedLocation.location
      : { lat: null, lng: null, address: 'Location unavailable' };
    await createSosIncident({ streamer_id, location, module_type: 'FULE_PROTECT', audio_transcript_snippet, source });
  },
  onSafe: markStreamerSafe
});

function scheduleDispatch(incident, { graceDelayMs = 10_000, escalationDelayMs = 30_000 } = {}) {
  const incidentId = incident.incident_id;
  const scheduled = { dispatch: null, escalation: null };
  scheduled.dispatch = setTimeout(() => {
    const current = incidents.get(incidentId);
    if (!current || current.status !== 'PENDING_DISPATCH') return;
    try {
      const dispatching = changeIncident(incidentId, { status: 'DISPATCHING' }, {
        event: 'DISPATCH_GRACE_EXPIRED', details: '10-second streamer cancellation grace elapsed'
      });
      io.to('guardians').emit('incident_dispatch_ready', dispatching);
      io.to(`streamer:${incidentId}`).emit('incident_dispatch_ready', dispatching);
      cancelCredentials.delete(incidentId);
      publishPublicUpdate(dispatching);

    } catch (error) {
      console.error('Could not mark incident ready for dispatch:', error.message);
    }
  }, graceDelayMs);
  scheduled.dispatch.unref?.();
  // The 30-second acknowledgement clock starts at SOS activation; the
  // 10-second cancel grace is included in that window. Schedule after dispatch
  // so equal/expired timers still transition into DISPATCHING before escalation.
  scheduled.escalation = setTimeout(() => {
    const current = incidents.get(incidentId);
    if (!current || current.status !== 'DISPATCHING') return;
    try {
      const escalated = changeIncident(incidentId, {
        status: 'ESCALATED',
        escalated: true,
        escalation_flag: 'contact emergency services (112)',
        recommended_action: 'CONTACT_EMERGENCY_SERVICES_112'
      }, { event: 'NO_GUARDIAN_ACK_ESCALATED', details: 'No guardian acknowledged within 30 seconds of SOS activation' });
      io.to('guardians').emit('incident_escalated', escalated);
      io.to(`streamer:${incidentId}`).emit('incident_escalated', escalated);
      publishPublicUpdate(escalated);
    } catch (error) {
      console.error('Could not record incident escalation:', error.message);
    }
  }, escalationDelayMs);
  scheduled.escalation.unref?.();
  timers.set(incidentId, scheduled);
}

function consumeInviteAttempt(key) {
  const now = Date.now();
  const active = (inviteAttempts.get(key) || []).filter((time) => time > now - 60_000);
  if (active.length >= 8) {
    inviteAttempts.set(key, active);
    return false;
  }
  active.push(now);
  inviteAttempts.set(key, active);
  if (inviteAttempts.size > 10_000) {
    for (const [attemptKey, timestamps] of inviteAttempts) {
      const recent = timestamps.filter((time) => time > now - 60_000);
      if (recent.length) inviteAttempts.set(attemptKey, recent);
      else inviteAttempts.delete(attemptKey);
    }
  }
  return true;
}

// Resume dispatch/escalation clocks for durable incidents after a process restart.
for (const incident of incidents.values()) {
  if (!['PENDING_DISPATCH', 'DISPATCHING'].includes(incident.status)) continue;
  const ageMs = Math.max(0, Date.now() - Date.parse(incident.created_at));
  const graceMs = Number(process.env.FULE_DISPATCH_GRACE_MS) || 10_000;
  const escalationMs = Number(process.env.FULE_ESCALATION_DELAY_MS) || 30_000;
  scheduleDispatch(incident, {
    graceDelayMs: incident.status === 'PENDING_DISPATCH' ? Math.max(0, graceMs - ageMs) : 0,
    escalationDelayMs: Math.max(0, escalationMs - ageMs)
  });
}

io.use((socket, next) => {
  const address = socket.handshake.address || 'unknown';
  const now = Date.now();
  const attempts = (socketAttemptsByIp.get(address) || []).filter((time) => time > now - 60_000);
  if (attempts.length >= 60) return next(new Error('Connection rate limit exceeded'));
  attempts.push(now); socketAttemptsByIp.set(address, attempts);
  if (socketAttemptsByIp.size > 10_000) {
    for (const [key, times] of socketAttemptsByIp) {
      const recent = times.filter((time) => time > now - 60_000);
      if (recent.length) socketAttemptsByIp.set(key, recent); else socketAttemptsByIp.delete(key);
    }
  }
  const token = socket.handshake.auth?.guardianToken;
  const guardian = authenticateGuardian(token);
  if (token && !guardian) return next(new Error('Guardian session is invalid or expired'));
  if (guardian) {
    socket.data.guardianId = guardian.guardian_id;
    socket.data.guardianExpiresAt = guardian.expires_at;
    socket.data.role = 'guardian';
  } else {
    socket.data.role = 'public';
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/auth/twitch', (_req, res) => {
  if (!twitch.configured()) return res.status(503).send('Twitch OAuth is not configured. Set backend Twitch credentials.');
  const state = twitch.createState();
  res.cookie(oauthStateCookie, state, { httpOnly: true, sameSite: 'lax', secure: parsedAllowedOrigin.protocol === 'https:', maxAge: 10 * 60 * 1000, path: '/auth/twitch/callback' });
  res.redirect(twitch.loginUrl(state));
});

app.get('/auth/twitch/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const validState = twitch.consumeState(state, getCookie(req, oauthStateCookie));
  res.clearCookie(oauthStateCookie, { httpOnly: true, sameSite: 'lax', secure: parsedAllowedOrigin.protocol === 'https:', path: '/auth/twitch/callback' });
  if (!validState) return res.status(400).send('Invalid or expired Twitch authorization state.');
  if (req.query.error || typeof req.query.code !== 'string') return res.status(400).send('Twitch authorization was not completed.');
  try {
    const result = await twitch.finishLogin(req.query.code);
    res.cookie(sessionCookie, result.session, { httpOnly: true, sameSite: sessionCookieSameSite, secure: parsedAllowedOrigin.protocol === 'https:', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
    res.redirect(allowedOrigin);
  } catch (error) { console.error('Twitch login failed:', error.message); res.status(502).send('Twitch login failed.'); }
});

app.get('/api/twitch/session', (req, res) => {
  const user = getTwitchUser(req);
  const connection = user && twitch.connections.get(user.id);
  return res.json({ user, eventsub_status: connection?.ready ? 'connected' : user ? 'connecting' : 'disconnected' });
});
app.post('/auth/twitch/logout', (req, res) => {
  const parsed = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${sessionCookie}=`));
  if (parsed) {
    try {
      const session = decodeURIComponent(parsed.slice(sessionCookie.length + 1));
      const user = twitch.session(session);
      twitch.logout(session);
      if (user) streamerLocations.delete(user.id);
    } catch { /* Ignore malformed cookie values. */ }
  }
  res.clearCookie(sessionCookie, { httpOnly: true, sameSite: sessionCookieSameSite, secure: parsedAllowedOrigin.protocol === 'https:', path: '/' }); res.json({ ok: true });
});
app.post('/api/streamer/location', (req, res) => {
  const streamer = getTwitchUser(req); if (!streamer) return res.status(401).json({ error: 'Twitch streamer login required.' });
  const validated = validateSosPayload({ streamer_id: streamer.id, location: req.body?.location, module_type: 'FULE_PROTECT', source: 'button' });
  if (!validated.ok) return res.status(400).json({ error: validated.error });
  streamerLocations.delete(streamer.id);
  streamerLocations.set(streamer.id, { location: validated.value.location, updatedAt: Date.now() });
  while (streamerLocations.size > 2_000) streamerLocations.delete(streamerLocations.keys().next().value);
  return res.json({ ok: true });
});

app.post('/api/guardians/verify', requestLimit({ limit: 8, windowMs: 60_000 }), (req, res) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  if (!consumeInviteAttempt(key)) { res.set('Retry-After', '60'); return res.status(429).json({ error: 'Too many invite attempts. Try again in one minute.' }); }
  const verified = verifyGuardianInvite(req.body?.invite_code, { allowDemo: demoMode });
  if (!verified) return res.status(401).json({ error: 'Invalid or inactive guardian invite.' });
  return res.json(verified);
});

app.get('/api/incidents', requestLimit({ limit: 60, windowMs: 60_000 }), (req, res) => {
  const guardian = getGuardian(req);
  if (!guardian) return res.status(403).json({ error: 'Verified guardian access required.' });
  return res.json({ incidents: [...incidents.values()].map(({ streamer_id, ...incident }) => incident), guardian_id: guardian.guardian_id });
});

app.post('/api/sos', requestLimit({ limit: Number(process.env.FULE_SOS_IP_LIMIT) || 6, windowMs: 60_000 }), async (req, res) => {
  const user = getTwitchUser(req);
  const authenticatedStreamer = user && req.body?.streamer_id === user.id;
  if (!authenticatedStreamer && !(demoMode && isLoopbackRequest(req))) return res.status(401).json({ error: 'Sign in with the matching Twitch streamer account to trigger SOS.' });
  const source = req.body?.source || 'button';
  if (source !== 'button' && !(demoMode && isLoopbackRequest(req))) return res.status(400).json({ error: 'Chat and redeem incidents must come from verified Twitch EventSub events.' });
  try { const result = await createSosIncident(req.body); return res.status(result.status).json(result.body); }
  catch (error) { console.error('Could not create SOS incident:', error.message); return res.status(500).json({ error: 'Could not create incident. Please retry.' }); }
});

io.on('connection', (socket) => {
  const address = socket.handshake.address || 'unknown';
  const connected = socketConnectionsByIp.get(address) || 0;
  if (connected >= 20) { socket.disconnect(true); return; }
  socketConnectionsByIp.set(address, connected + 1);
  socket.on('disconnect', () => {
    const remaining = Math.max(0, (socketConnectionsByIp.get(address) || 1) - 1);
    if (remaining) socketConnectionsByIp.set(address, remaining); else socketConnectionsByIp.delete(address);
  });
  if (socket.data.role === 'guardian') {
    socket.join('guardians');
    const expirationTimer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.guardianExpiresAt - Date.now()));
    expirationTimer.unref?.();
    socket.on('disconnect', () => clearTimeout(expirationTimer));
  } else socket.join('public');
  socket.emit('fule:access', { role: socket.data.role, guardian_id: socket.data.guardianId || null });

  socket.on('register_streamer', (payload = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || socket.data.streamerIncidentId) return;
    const { incident_id, streamer_id, cancel_token } = payload;
    const incident = incidents.get(String(incident_id || ''));
    const credentials = cancelCredentials.get(String(incident_id || ''));
    if (!incident || incident.status !== 'PENDING_DISPATCH' || !credentials || credentials.streamer_id !== streamer_id || !tokenMatches(cancel_token, credentials.token_hash)) {
      socket.emit('streamer_registration_failed', { incident_id: incident_id || null });
      return;
    }
    socket.data.streamerIncidentId = incident.incident_id;
    socket.data.streamerId = streamer_id;
    socket.join(`streamer:${incident.incident_id}`);
    socket.emit('streamer_registered', { incident_id: incident.incident_id, dispatch_ready_at: new Date(credentials.dispatch_ready_at).toISOString() });
  });

  socket.on('acknowledge_incident', (incidentId) => {
    if (socket.data.role !== 'guardian' || !socket.data.guardianId) return;
    if (typeof incidentId !== 'string' || incidentId.length > 128) return;
    const current = incidents.get(String(incidentId));
    if (!current || !['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(current.status)) return;
    clearIncidentTimers(current.incident_id);
    try {
      const acknowledged = changeIncident(current.incident_id, {
        status: 'ACKNOWLEDGED', acknowledged_by: socket.data.guardianId
      }, { event: 'INCIDENT_ACKNOWLEDGED', actorId: socket.data.guardianId });
      io.to('guardians').emit('incident_acknowledged', acknowledged);
      io.to(`streamer:${current.incident_id}`).emit('incident_acknowledged', acknowledged);
      cancelCredentials.delete(current.incident_id);
      publishPublicUpdate(acknowledged);
    } catch (error) {
      console.error('Could not acknowledge incident:', error.message);
    }
  });

  const handleStreamerCancellation = (eventName, status) => (payload = {}) => {
    const incidentId = socket.data.streamerIncidentId;
    const current = incidentId && incidents.get(incidentId);
    const credentials = incidentId && cancelCredentials.get(incidentId);
    if (!current || !credentials || socket.data.streamerId !== credentials.streamer_id || payload.incident_id !== incidentId) return;
    if (current.status !== 'PENDING_DISPATCH' || Date.now() > credentials.dispatch_ready_at) {
      socket.emit('streamer_action_rejected', { incident_id: incidentId, reason: 'The 10-second dispatch grace window has ended.' });
      return;
    }
    clearIncidentTimers(incidentId);
    try {
      const cancelled = changeIncident(incidentId, { status }, {
        event: eventName.toUpperCase(), actorId: socket.data.streamerId
      });
      cancelCredentials.delete(incidentId);
      io.to('guardians').emit('sos_cancelled', cancelled);
      publishPublicUpdate(cancelled);
      socket.emit('streamer_action_confirmed', { incident_id: incidentId, status });
    } catch (error) {
      console.error('Could not cancel SOS:', error.message);
    }
  };

  socket.on('false_alarm', handleStreamerCancellation('false_alarm', 'FALSE_ALARM'));
  socket.on('cancel_sos', handleStreamerCancellation('cancel_sos', 'CANCELLED'));
});

httpServer.listen(port, () => {
  console.log(`FULE Protect API listening on port ${port} (${demoMode ? 'demo mode' : 'verified guardian mode'})`);
});

httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`FULE backend could not bind port ${port}: another process is using it. Stop the old FULE server or set PORT in backend/.env.`);
  else console.error('FULE backend failed to start:', error.message);
  process.exit(1);
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON request.' });
  console.error('Request middleware error:', error.message);
  return res.status(500).json({ error: 'Request could not be processed.' });
});

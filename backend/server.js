import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { INCIDENT_MODULE, createIncident, isIncident, toPublicIncident } from '../shared/incident.mjs';
import { authenticateGuardian, seedDemoInvite, verifyGuardianInvite } from './services/guardianRegistry.js';
import { writeAudit } from './services/auditLog.js';
import { deterministicFallback, synthesizeIncident } from './services/incidentSynthesizer.js';
import { createStreamerRateLimiter, validateSosPayload } from './services/sosValidation.js';
import { TwitchIntegration } from './services/twitchIntegration.js';
import { incidentRepository, loadIncidents, getIncident, listIncidentPage, listDispatchQueue, persistIncident, removeIncident, loadTrustedContactsFresh, saveTrustedContacts, recordFalseAlarm, flushIncidentWrites, cleanupIncidentData, closeIncidentStore } from './services/incidentStore.js';
import { createDispatchProvider, createEmergencyReport } from './services/dispatchBridge.js';
import { createEscalationLadder } from './services/escalationLadder.js';
import { notifyTrustedContacts } from './services/trustedContactNotifier.js';
import { authenticateAccess, loginAccount, refreshAccount, registerAccount, requestGuardianApproval, approveGuardian } from './services/accountService.js';
import { redis, redisEnabled, installSocketAdapter, verifyRuntimeInfrastructure, scheduleEscalationJobs, cancelEscalationJobs, startBackgroundWorkers, closeRuntimeInfrastructure } from './services/runtimeInfrastructure.js';
import { activeSockets, alertDeliveryLatency, httpRequests, log, metricsRegistry, queueDepth } from './services/securityMetrics.js';
import { twitchAccountStore } from './services/twitchAccountStore.js';

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
if (process.env.SENTRY_DSN) Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.request) {
      delete event.request.data;
      if (event.request.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers.Authorization;
        delete event.request.headers.Cookie;
      }
    }
    return event;
  }
});
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production.');
if (process.env.NODE_ENV === 'production' && !process.env.METRICS_TOKEN) throw new Error('METRICS_TOKEN is required in production.');
const dispatchProvider = createDispatchProvider({
  demoMode,
  url: process.env.DISPATCH_WEBHOOK_URL,
  secret: process.env.DISPATCH_WEBHOOK_SECRET,
  retries: Number(process.env.DISPATCH_WEBHOOK_RETRIES) || 2
});
const parsedAllowedOrigin = new URL(allowedOrigin);
if (!['http:', 'https:'].includes(parsedAllowedOrigin.protocol) || parsedAllowedOrigin.origin !== allowedOrigin) {
  throw new Error('FRONTEND_ORIGIN must be a single HTTP(S) origin without a path.');
}
if (!demoMode && parsedAllowedOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsedAllowedOrigin.hostname)) {
  throw new Error('Non-demo deployments must use an HTTPS FRONTEND_ORIGIN.');
}
if (demoMode) seedDemoInvite(process.env.FULE_DEMO_GUARDIAN_INVITE);

function isAllowedOrigin(origin) {
  if (!origin || origin === allowedOrigin) return true;
  if (!demoMode || !['localhost', '127.0.0.1'].includes(parsedAllowedOrigin.hostname)) return false;
  try {
    const candidate = new URL(origin);
    const portNumber = Number(candidate.port || (candidate.protocol === 'https:' ? 443 : 80));
    return candidate.protocol === parsedAllowedOrigin.protocol
      && candidate.hostname === parsedAllowedOrigin.hostname
      && portNumber >= 5173 && portNumber <= 5199;
  } catch {
    return false;
  }
}

const io = new Server(httpServer, {
  cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), methods: ['GET', 'POST'], credentials: true },
  maxHttpBufferSize: 64 * 1024,
  allowRequest: (request, callback) => {
    const origin = request.headers.origin;
    callback(null, isAllowedOrigin(origin));
  }
});
installSocketAdapter(io);
const rateLimitSos = createStreamerRateLimiter({ limit: 3, windowMs: 5 * 60 * 1000 });
const incidents = new Map(loadIncidents().map((stored) => {
  const incident = { ...createIncident(stored), ...(stored.streamer_id ? { streamer_id: stored.streamer_id } : {}) };
  return [incident.incident_id, incident];
}));
const cancelCredentials = new Map();
const timers = new Map();
const inviteAttempts = new Map();
const streamerLocations = new Map();
const sessionCookie = 'fule_twitch_session';
const oauthStateCookie = 'fule_twitch_oauth_state';
const sessionCookieSameSite = parsedAllowedOrigin.protocol === 'https:' ? 'none' : 'lax';
const loadTestTokenHash = process.env.FULE_LOAD_TEST_TOKEN ? hashToken(process.env.FULE_LOAD_TEST_TOKEN).toString('hex') : '';
const requestBuckets = new Map();
const creatingIncidents = new Set();
const memoryIdempotency = new Map();
const socketConnectionsByIp = new Map();
const socketAttemptsByIp = new Map();

async function saveStreamerLocation(streamerId, location) {
  const value = { location, updatedAt: Date.now() };
  if (redis) await redis.set(`fule:streamer-location:${streamerId}`, JSON.stringify(value), 'EX', 600);
  else { streamerLocations.delete(streamerId); streamerLocations.set(streamerId, value); }
}
async function getStreamerLocation(streamerId) {
  let saved = streamerLocations.get(streamerId);
  if (redis) {
    const raw = await redis.get(`fule:streamer-location:${streamerId}`);
    try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  }
  return saved && Date.now() - saved.updatedAt < 10 * 60_000 ? saved.location : { lat: null, lng: null, address: 'Location unavailable' };
}

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || false);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use((req, res, next) => {
  req.id = String(req.get('x-request-id') || randomBytes(12).toString('hex')).slice(0, 128);
  res.setHeader('x-request-id', req.id);
  res.on('finish', () => {
    httpRequests.inc({ method: req.method, route: req.route?.path || req.path, status: String(res.statusCode) });
    log(res.statusCode >= 500 ? 'error' : 'info', 'http_request', { request_id: req.id, method: req.method, path: req.path, status: res.statusCode, duration_ms: Number(process.hrtime.bigint() - req._startedAt) / 1e6 });
  });
  req._startedAt = process.hrtime.bigint();
  next();
});
app.use(cors({
  origin(origin, callback) {
    return callback(null, isAllowedOrigin(origin) ? origin || false : false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
  if (!isAllowedOrigin(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return res.status(415).json({ error: 'Requests must use application/json.' });
  }
  next();
}

function requestLimit({ limit, windowMs }) {
  return (req, res, next) => {
    if (redis) {
      const key = `fule:ratelimit:${req.ip || req.socket.remoteAddress || 'unknown'}:${req.baseUrl}${req.path}`;
      redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}", 1, key, windowMs)
        .then(([count, ttl]) => {
          if (count > limit) { res.set('Retry-After', String(Math.ceil(ttl / 1000))); return res.status(429).json({ error: 'Request rate limit exceeded.' }); }
          res.set('RateLimit-Limit', String(limit)); res.set('RateLimit-Remaining', String(Math.max(0, limit - count))); next();
        }).catch((error) => { log('error', 'redis_rate_limit_failed', { request_id: req.id, error: error.message }); if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Rate limiting service unavailable.' }); next(); });
      return;
    }
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

async function distributedSosLimit(streamerId) {
  if (!redis) return rateLimitSos(streamerId);
  const result = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}", 1, `fule:sos:${streamerId}`, 300_000);
  return { allowed: result[0] <= 3, remaining: Math.max(0, 3 - result[0]), retryAfterMs: result[1] };
}

async function loadCancelCredential(incidentId) {
  if (incidentRepository.db) {
    const row = await incidentRepository.db('streamer_incident_sessions').where({ incident_id: incidentId }).where('expires_at', '>', new Date()).first();
    if (row) return { streamer_id: row.streamer_id, token_hash: row.token_hash };
  }
  return cancelCredentials.get(incidentId) || null;
}
async function saveCancelCredential(incidentId, credential) {
  cancelCredentials.set(incidentId, credential);
  if (incidentRepository.db) await incidentRepository.db('streamer_incident_sessions').insert({ incident_id: incidentId, streamer_id: credential.streamer_id, token_hash: credential.token_hash, expires_at: new Date(Date.now() + 10 * 60_000) }).onConflict('incident_id').merge();
}
async function deleteCancelCredential(incidentId) {
  cancelCredentials.delete(incidentId);
  if (incidentRepository.db) await incidentRepository.db('streamer_incident_sessions').where({ incident_id: incidentId }).del();
}

app.use(enforceRequestSafety);
app.use('/api', requestLimit({ limit: Number(process.env.FULE_API_IP_LIMIT) || 180, windowMs: 60_000 }));
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

async function getTwitchUser(req) {
  const cookie = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${sessionCookie}=`));
  if (!cookie) return null;
  try { return await twitch.sessionAsync(decodeURIComponent(cookie.slice(sessionCookie.length + 1))); }
  catch { return null; }
}

async function getStreamerIdentity(req, suppliedId = '') {
  const user = await getTwitchUser(req);
  if (user?.id) return { id: user.id, user };
  if (demoMode && isLoopbackRequest(req) && typeof suppliedId === 'string' && suppliedId.trim()) return { id: suppliedId.trim().slice(0, 128), user: null };
  return null;
}

function getCookie(req, name) {
  const pair = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)); }
  catch { return null; }
}

function isLoopbackAddress(value) {
  const address = String(value || '').toLowerCase();
  return address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.') || address === 'localhost';
}

function isLoopbackRequest(req) { return isLoopbackAddress(req.socket.remoteAddress || req.ip); }

async function writeStateChange({ incident, event, fromStatus, toStatus, actorId, details }) {
  await writeAudit({
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
    escalation_flag: incident.escalation_flag,
    dispatch_stage: incident.dispatch_stage,
    dispatch_status: incident.dispatch_record?.status || null,
    contacts_notified: Boolean(incident.contacts_notified_at)
  });
}

function clearIncidentTimers(incidentId) {
  const scheduled = timers.get(incidentId);
  if (scheduled) {
    if (typeof scheduled.cancel === 'function') scheduled.cancel();
    clearTimeout(scheduled.dispatch);
    clearTimeout(scheduled.escalation);
    timers.delete(incidentId);
  }
  if (redisEnabled) void cancelEscalationJobs(incidentId);
}

async function changeIncident(incidentId, patch, { event, actorId, details } = {}) {
  let current;
  let updated;
  if (incidentRepository.db) {
    await incidentRepository.db.transaction(async (transaction) => {
      const row = await transaction('incidents').where({ incident_id: incidentId }).forUpdate().first('payload', 'streamer_id');
      if (!row) return;
      current = { ...createIncident(row.payload), ...(row.streamer_id ? { streamer_id: row.streamer_id } : {}) };
      updated = createIncident({ ...current, ...patch });
      if (current.streamer_id) updated.streamer_id = current.streamer_id;
      if (!isIncident(updated)) throw new Error('Incident state failed schema validation');
      await transaction('incidents').where({ incident_id: incidentId }).update({ created_at: new Date(updated.created_at), status: updated.status, streamer_id: updated.streamer_id || '', payload: JSON.stringify(updated) });
      await transaction('audit_events').insert({
        event: event || 'STATE_CHANGE', incident_id: incidentId, actor_id: actorId || null,
        payload: JSON.stringify({ at: new Date().toISOString(), event, incident_id: incidentId, from_status: current.status, to_status: updated.status, actor_id: actorId || null, details: details || null }),
        created_at: new Date()
      });
    });
  } else {
    current = await getIncident(incidentId);
    if (!current) return null;
    updated = createIncident({ ...current, ...patch });
    if (current.streamer_id) updated.streamer_id = current.streamer_id;
    if (!isIncident(updated)) throw new Error('Incident state failed schema validation');
    await writeStateChange({ incident: updated, event, fromStatus: current.status, toStatus: updated.status, actorId, details });
    await persistIncident(updated);
  }
  if (!updated) return null;
  incidents.set(incidentId, updated);
  return updated;
}

async function emitIncidentUpdate(incident, eventName) {
  await flushIncidentWrites();
  io.to('guardians').emit(eventName, incident);
  io.to('dispatch').emit(eventName, incident);
  io.to(`streamer:${incident.incident_id}`).emit(eventName, incident);
  publishPublicUpdate(incident);
}

function currentNeedsResponse(incidentId) {
  const current = incidents.get(incidentId);
  return Boolean(current && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(current.status) && current.status !== 'ACKNOWLEDGED');
}

async function contactTrustedPeople(incidentId) {
  const current = await getIncident(incidentId);
  if (!current || !currentNeedsResponse(incidentId) || current.contacts_notified_at) return;
  const contacts = await loadTrustedContactsFresh(current.streamer_id || '');
  let result = { status: 'SKIPPED', notified: [], error: null };
  if (contacts.length) {
    try { result = await notifyTrustedContacts({ contacts, incident: current, demoMode }); }
    catch (error) { result = { status: 'FAILED', notified: [], error: error.message }; }
  }
  const updated = await changeIncident(incidentId, {
    contacts_notified_at: new Date().toISOString(),
    dispatch_stage: current.dispatch_record?.status === 'SENT' ? current.dispatch_stage : 'CONTACTS'
  }, {
    event: result.status === 'FAILED' ? 'TRUSTED_CONTACTS_NOTIFICATION_FAILED' : 'TRUSTED_CONTACTS_NOTIFIED',
    actorId: 'system', details: `${result.status}; ${result.notified.length} contact(s)`
  });
  io.to('guardians').emit('trusted_contacts_notified', { incident_id: incidentId, status: result.status, count: result.notified.length });
  io.to(`streamer:${incidentId}`).emit('trusted_contacts_notified', { incident_id: incidentId, status: result.status, count: result.notified.length });
  publishPublicUpdate(updated);
}

async function sendToDispatch(incidentId, cause = 'ESCALATION') {
  let current = await getIncident(incidentId);
  if (!current || !currentNeedsResponse(incidentId) || current.dispatch_record?.status === 'SENT' || current.dispatch_record?.status === 'ACKNOWLEDGED') return;
  const queuedRecord = current.dispatch_record?.status === 'QUEUED' ? current.dispatch_record : {
    dispatch_id: `dispatch-${randomBytes(8).toString('hex')}`,
    status: 'QUEUED', responder_eta_minutes: null, queued_at: new Date().toISOString(), sent_at: null, stage: 'QUEUED', simulated: demoMode
  };
  const queued = await changeIncident(incidentId, { dispatch_record: queuedRecord, dispatch_stage: current.contacts_notified_at ? 'CONTACTS' : 'GUARDIANS' }, {
    event: 'DISPATCH_QUEUED', actorId: 'system', details: `Dispatch queued by ${cause}; provider=${dispatchProvider.name}`
  });
  emitIncidentUpdate(queued, 'dispatch_queued');
  current = incidents.get(incidentId);
  const twitchAccount = current.streamer_contact || (current.streamer_id ? twitch.accounts.get(current.streamer_id) : null);
  const report = createEmergencyReport(current, {
    streamerContact: current.streamer_contact || (twitchAccount ? { streamer_id: current.streamer_id, display_name: twitchAccount.display_name || twitchAccount.login, twitch_login: twitchAccount.login } : null),
    guardianResponses: current.guardian_responses || []
  });
  try {
    let sentRecord = await dispatchProvider.dispatch(report);
    sentRecord = { ...sentRecord, dispatch_id: sentRecord.dispatch_id || queuedRecord.dispatch_id, status: sentRecord.status || 'SENT', sent_at: sentRecord.sent_at || new Date().toISOString(), stage: 'SENT', incident_id: incidentId };
    let latest = await getIncident(incidentId);
    if (['CANCELLED', 'FALSE_ALARM'].includes(latest?.status)) {
      const stoodDown = await dispatchProvider.standDown(sentRecord, 'Streamer cancelled while provider send was in flight.');
      const cancelled = await changeIncident(incidentId, { dispatch_record: { ...stoodDown, status: 'ACKNOWLEDGED', stage: 'STAND_DOWN' }, dispatch_stage: 'STAND_DOWN' }, { event: 'DISPATCH_STOOD_DOWN', actorId: 'system', details: 'Dispatch send completed after a cancellation; provider was stood down.' });
      await deleteCancelCredential(incidentId);
      emitIncidentUpdate(cancelled, 'dispatch_status_updated');
      return;
    }
    const escalated = await changeIncident(incidentId, {
      status: 'ESCALATED', escalated: true, escalation_flag: 'Emergency dispatch sent; if immediate danger continues, call 112.',
      recommended_action: 'COORDINATE_WITH_EMERGENCY_DISPATCH', dispatch_record: sentRecord, dispatch_stage: 'POLICE_DISPATCHED'
    }, { event: 'DISPATCH_SENT', actorId: 'system', details: `Dispatch sent via ${dispatchProvider.name}; ETA ${sentRecord.responder_eta_minutes ?? 'unknown'} minutes.` });
    await deleteCancelCredential(incidentId);
    emitIncidentUpdate(escalated, 'dispatch_sent');
    io.to('guardians').emit('incident_escalated', escalated);
    io.to(`streamer:${incidentId}`).emit('incident_escalated', escalated);
  } catch (error) {
    const latest = await getIncident(incidentId);
    if (!latest || ['CANCELLED', 'FALSE_ALARM'].includes(latest.status)) return;
    const failed = await changeIncident(incidentId, {
      status: 'ESCALATED', escalated: true,
      escalation_flag: 'Automated dispatch failed. Call emergency services (112) now.',
      recommended_action: 'CONTACT_EMERGENCY_SERVICES_112',
      dispatch_record: { ...queuedRecord, status: 'FAILED', sent_at: null, stage: 'FAILED' }, dispatch_stage: 'FAILED'
    }, { event: 'DISPATCH_FAILED', actorId: 'system', details: error.message });
    emitIncidentUpdate(failed, 'dispatch_status_updated');
    io.to('guardians').emit('incident_escalated', failed);
    io.to(`streamer:${incidentId}`).emit('incident_escalated', failed);
  }
}

async function standDownDispatch(incidentId, reason, actorId) {
  const current = await getIncident(incidentId);
  if (!current || !['SENT', 'ACKNOWLEDGED'].includes(current.dispatch_record?.status) || current.dispatch_stage === 'STAND_DOWN') return null;
  const record = { ...current.dispatch_record, incident_id: incidentId };
  try {
    const stoodDown = await dispatchProvider.standDown(record, reason || 'Incident stood down by authorized responder.');
    const updated = await changeIncident(incidentId, { dispatch_record: { ...stoodDown, status: 'ACKNOWLEDGED', stage: 'STAND_DOWN' }, dispatch_stage: 'STAND_DOWN' }, {
      event: 'DISPATCH_STOOD_DOWN', actorId, details: 'Explicit stand-down sent to dispatch provider.'
    });
    await deleteCancelCredential(incidentId);
    emitIncidentUpdate(updated, 'dispatch_status_updated');
    return updated;
  } catch (error) {
    writeAudit({ event: 'DISPATCH_STAND_DOWN_FAILED', incident_id: incidentId, actor_id: actorId, details: error.message });
    return null;
  }
}

async function updateDispatchStage(incidentId, stage, actorId) {
  const current = await getIncident(incidentId);
  if (!current || !['SENT', 'ACKNOWLEDGED'].includes(current.dispatch_record?.status)) return null;
  try {
    const nextRecord = await dispatchProvider.update({ ...current.dispatch_record, incident_id: incidentId }, stage);
    const dispatchStage = stage === 'ACCEPTED' ? 'POLICE_DISPATCHED' : stage;
    const status = stage === 'RESOLVED' ? 'RESOLVED' : current.status;
    const updated = await changeIncident(incidentId, { status, dispatch_record: { ...nextRecord, stage: dispatchStage }, dispatch_stage: dispatchStage }, {
      event: `DISPATCH_${stage}`, actorId, details: `Dispatch control room set ${stage}.`
    });
    emitIncidentUpdate(updated, stage === 'ACCEPTED' ? 'dispatch_acknowledged' : 'dispatch_status_updated');
    return updated;
  } catch (error) {
    writeAudit({ event: 'DISPATCH_UPDATE_FAILED', incident_id: incidentId, actor_id: actorId, details: error.message });
    return null;
  }
}

async function createSosIncident(input) {
  const validated = validateSosPayload(input);
  if (!validated.ok) return { status: 400, body: { error: validated.error } };
  const payload = validated.value;
  const limit = await distributedSosLimit(payload.streamer_id);
  if (!limit.allowed) return { status: 429, body: { error: 'SOS rate limit reached. Maximum 3 activations per streamer every 5 minutes.' } };
  const hasActiveIncident = incidentRepository.db
    ? Boolean(await incidentRepository.db('incidents').where({ streamer_id: payload.streamer_id }).whereIn('status', ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED']).first('incident_id'))
    : [...incidents.values()].some((item) => item.streamer_id === payload.streamer_id && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(item.status));
  if (hasActiveIncident) {
    return { status: 409, body: { error: 'An active incident already exists for this streamer.' } };
  }
  if (creatingIncidents.has(payload.streamer_id)) return { status: 409, body: { error: 'An SOS is already being processed for this streamer.' } };
  const activeIncidentCount = incidentRepository.db
    ? Number((await incidentRepository.db('incidents').whereIn('status', ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED']).count({ count: '*' }).first()).count)
    : incidents.size;
  if (activeIncidentCount >= 2_000) {
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
    source: payload.source, stream_url: twitchAccount ? `https://www.twitch.tv/${twitchAccount.login}` : null,
    transcript_snippet: payload.audio_transcript_snippet,
    streamer_contact: { streamer_id: payload.streamer_id, display_name: twitchAccount?.display_name || (demoMode ? 'Demo Streamer' : twitchAccount?.login || 'Streamer'), twitch_login: twitchAccount?.login || '' },
    dispatch_stage: 'GUARDIANS'
  });
  if (!isIncident(incident)) return { status: 500, body: { error: 'Incident failed schema validation.' } };
  const cancelToken = randomBytes(32).toString('base64url');
  const contactsDelayMs = Number(process.env.FULE_CONTACTS_DELAY_MS) || 30_000;
  const dispatchDelayMs = Number(process.env.FULE_DISPATCH_DELAY_MS) || Number(process.env.FULE_ESCALATION_DELAY_MS) || 60_000;
  const persistedIncident = { ...incident, streamer_id: payload.streamer_id };
  const cancelCredential = { streamer_id: payload.streamer_id, token_hash: hashToken(cancelToken).toString('hex') };
  if (incidentRepository.db) {
    await incidentRepository.db.transaction(async (transaction) => {
      await transaction('incidents').insert({ incident_id: incident.incident_id, created_at: new Date(incident.created_at), status: incident.status, streamer_id: payload.streamer_id, payload: JSON.stringify(persistedIncident) });
      await transaction('audit_events').insert({ event: 'SOS_CREATED', incident_id: incident.incident_id, actor_id: payload.streamer_id, payload: JSON.stringify({ at: new Date().toISOString(), event: 'SOS_CREATED', incident_id: incident.incident_id, from_status: null, to_status: incident.status, actor_id: payload.streamer_id }), created_at: new Date() });
      await transaction('streamer_incident_sessions').insert({ incident_id: incident.incident_id, streamer_id: payload.streamer_id, token_hash: cancelCredential.token_hash, expires_at: new Date(Date.now() + 7 * 86_400_000) });
    });
    cancelCredentials.set(incident.incident_id, cancelCredential);
  } else {
    await persistIncident(persistedIncident);
    await writeStateChange({ incident, event: 'SOS_CREATED', fromStatus: null, toStatus: incident.status, actorId: payload.streamer_id });
    await saveCancelCredential(incident.incident_id, cancelCredential);
  }
  incidents.set(incident.incident_id, persistedIncident);
  await flushIncidentWrites();
  const broadcastStarted = process.hrtime.bigint();
  io.to('guardians').emit('sos_activated', { ...incident, grace_period_seconds: 10 });
  io.to('public').emit('incident:public', toPublicIncident(incident));
  alertDeliveryLatency.observe(Number(process.hrtime.bigint() - broadcastStarted) / 1e9);
  await scheduleDispatch(incident, { contactsDelayMs, dispatchDelayMs });
  void synthesizeIncident(synthesisInput).then(async (aiResult) => {
    if (!incidents.has(incident.incident_id)) return;
    const updated = await changeIncident(incident.incident_id, aiResult, { event: 'AI_SYNTHESIS_UPDATED', actorId: 'system' });
    void emitIncidentUpdate(updated, 'incident_updated');
  }).catch((error) => log('error', 'incident_synthesis_update_failed', { incident_id: incident.incident_id, error: error.message }));
  void twitch.createClip(payload.streamer_id).then(async (clipUrl) => {
    if (!clipUrl) return;
    const current = incidents.get(incident.incident_id); if (!current) return;
    const updated = await changeIncident(incident.incident_id, { clip_url: clipUrl }, { event: 'CLIP_ATTACHED', actorId: payload.streamer_id, details: 'Twitch clip captured after SOS activation' });
    await flushIncidentWrites();
    io.to('guardians').emit('incident_clip_ready', updated);
  });
  return { status: 201, body: { incident, streamer_cancel_token: cancelToken } };
  } finally {
    creatingIncidents.delete(payload.streamer_id);
  }
}

async function markStreamerSafe(streamerId) {
  const stored = incidentRepository.db
    ? (await incidentRepository.db('incidents').select('payload', 'streamer_id').where({ streamer_id: streamerId }).whereIn('status', ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED']).orderBy('created_at', 'desc').first())
    : null;
  const current = stored ? { ...createIncident(stored.payload), streamer_id: stored.streamer_id } : [...incidents.values()].find((item) => item.streamer_id === streamerId && ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(item.status));
  if (!current) return false;
  if (['SENT', 'ACKNOWLEDGED'].includes(current.dispatch_record?.status)) return false;
  clearIncidentTimers(current.incident_id);
  const falseAlarmCount = await recordFalseAlarm(streamerId);
  const cancelled = await changeIncident(current.incident_id, { status: 'FALSE_ALARM', repeat_offender: falseAlarmCount >= 3 }, { event: 'CHAT_SAFE_FALSE_ALARM', actorId: streamerId, details: `False alarm count: ${falseAlarmCount}${falseAlarmCount >= 3 ? '; repeat-offender flag set.' : ''}` });
  await deleteCancelCredential(current.incident_id);
  cancelCredentials.delete(current.incident_id);
  emitIncidentUpdate(cancelled, 'sos_cancelled'); return true;
}

const twitch = new TwitchIntegration({
  clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET,
  redirectUri: process.env.TWITCH_REDIRECT_URI || 'http://localhost:4000/auth/twitch/callback',
  rewardId: process.env.TWITCH_SILENT_SOS_REWARD_ID || '',
  rewardCost: process.env.TWITCH_SILENT_SOS_COST || 1,
  persistence: twitchAccountStore,
  onConnectionState: ({ user_id, status, details }) => writeAudit({
    event: 'TWITCH_EVENTSUB_CONNECTION_STATE', actor_id: user_id, details: `${status}: ${details}`
  }),
  onSos: async ({ streamer_id, source, audio_transcript_snippet }) => {
    const location = await getStreamerLocation(streamer_id);
    await createSosIncident({ streamer_id, location, module_type: 'FULE_PROTECT', audio_transcript_snippet, source });
  },
  onSafe: markStreamerSafe
});

async function scheduleDispatch(incident, { contactsDelayMs = 30_000, dispatchDelayMs = 60_000 } = {}) {
  const incidentId = incident.incident_id;
  if (redisEnabled) {
    await scheduleEscalationJobs(incidentId, { contactsDelayMs, dispatchDelayMs: incident.threat_level === 'CRITICAL' ? 0 : dispatchDelayMs });
    timers.set(incidentId, { cancel: () => { void cancelEscalationJobs(incidentId); } });
    return;
  }
  const scheduled = createEscalationLadder({
    incident,
    contactsDelayMs,
    dispatchDelayMs,
    isAcknowledged: () => incidents.get(incidentId)?.status === 'ACKNOWLEDGED',
    isCancelled: () => ['CANCELLED', 'FALSE_ALARM', 'RESOLVED'].includes(incidents.get(incidentId)?.status),
    isDispatchSent: () => ['SENT', 'ACKNOWLEDGED'].includes(incidents.get(incidentId)?.dispatch_record?.status),
    onContacts: () => contactTrustedPeople(incidentId),
    onDispatch: () => sendToDispatch(incidentId, incident.threat_level === 'CRITICAL' ? 'CRITICAL_THREAT' : 'T_PLUS_60')
  });
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
  const contactsMs = Number(process.env.FULE_CONTACTS_DELAY_MS) || 30_000;
  const dispatchMs = Number(process.env.FULE_DISPATCH_DELAY_MS) || Number(process.env.FULE_ESCALATION_DELAY_MS) || 60_000;
  void scheduleDispatch(incident, {
    contactsDelayMs: contactsMs,
    dispatchDelayMs: dispatchMs
  });
}

io.use(async (socket, next) => {
  const address = socket.handshake.address || 'unknown';
  const now = Date.now();
  const attempts = (socketAttemptsByIp.get(address) || []).filter((time) => time > now - 60_000);
  if (attempts.length >= (Number(process.env.SOCKET_CONNECT_RATE_LIMIT) || 2_000)) return next(new Error('Connection rate limit exceeded'));
  attempts.push(now); socketAttemptsByIp.set(address, attempts);
  if (socketAttemptsByIp.size > 10_000) {
    for (const [key, times] of socketAttemptsByIp) {
      const recent = times.filter((time) => time > now - 60_000);
      if (recent.length) socketAttemptsByIp.set(key, recent); else socketAttemptsByIp.delete(key);
    }
  }
  if (redis) {
    try {
      const minute = Math.floor(now / 60_000);
      const count = await redis.incr(`fule:socket-attempts:${address}:${minute}`);
      if (count === 1) await redis.expire(`fule:socket-attempts:${address}:${minute}`, 120);
      if (count > (Number(process.env.SOCKET_CONNECT_RATE_LIMIT) || 2_000)) return next(new Error('Connection rate limit exceeded'));
    } catch { return next(new Error('Shared connection limiter is unavailable.')); }
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

app.get('/api/ready', async (_req, res) => {
  try {
    if (incidentRepository.db) await incidentRepository.db.raw('select 1');
    await verifyRuntimeInfrastructure();
    res.json({ status: 'ready', database: incidentRepository.db ? 'postgresql' : 'demo-file', redis: redisEnabled ? 'connected' : 'disabled' });
  } catch (error) { res.status(503).json({ status: 'not_ready', error: error.message }); }
});

app.get('/metrics', async (_req, res) => {
  if (process.env.METRICS_TOKEN && reqToken(_req) !== process.env.METRICS_TOKEN) return res.status(403).end();
  try {
    activeSockets.set(io.engine.clientsCount);
    if (redis) {
      const counts = await Promise.all(['fule-escalations', 'fule-maintenance'].map((queue) => redis.llen(`bull:${queue}:wait`)));
      queueDepth.set({ queue: 'fule-escalations' }, counts[0]); queueDepth.set({ queue: 'fule-maintenance' }, counts[1]);
    }
    res.set('Content-Type', metricsRegistry.contentType).send(await metricsRegistry.metrics());
  } catch (error) { res.status(503).send(error.message); }
});

function reqToken(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }

app.post('/api/auth/register', requestLimit({ limit: 5, windowMs: 60_000 }), async (req, res) => {
  try { return res.status(201).json(await registerAccount(req.body || {})); }
  catch (error) { return res.status(400).json({ error: error.message }); }
});
app.post('/api/auth/login', requestLimit({ limit: 10, windowMs: 60_000 }), async (req, res) => {
  try { return res.json(await loginAccount(req.body || {})); }
  catch (error) { return res.status(401).json({ error: error.message }); }
});
app.post('/api/auth/refresh', requestLimit({ limit: 20, windowMs: 60_000 }), async (req, res) => {
  try { return res.json(await refreshAccount(req.body?.refresh_token)); }
  catch (error) { return res.status(401).json({ error: error.message }); }
});
app.post('/api/auth/guardian-request', async (req, res) => {
  const identity = authenticateAccess(reqToken(req));
  if (!identity || identity.role !== 'user') return res.status(403).json({ error: 'User account required.' });
  try { const updated = await requestGuardianApproval(identity.account_id); if (updated) await writeAudit({ event: 'GUARDIAN_APPROVAL_REQUESTED', actor_id: identity.account_id }); return res.json({ requested: Boolean(updated) }); }
  catch (error) { return res.status(503).json({ error: error.message }); }
});
app.get('/api/admin/guardians/pending', async (req, res) => {
  const identity = authenticateAccess(reqToken(req));
  if (!identity || identity.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  if (!incidentRepository.db) return res.json({ accounts: [] });
  const accounts = await incidentRepository.db('accounts').select('account_id', 'email', 'created_at').where({ role: 'guardian_pending' }).orderBy('created_at', 'asc');
  res.json({ accounts });
});
app.post('/api/admin/guardians/:accountId/approve', async (req, res) => {
  const identity = authenticateAccess(reqToken(req));
  if (!identity || identity.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  try { const accountId = String(req.params.accountId).slice(0, 160); const updated = await approveGuardian(accountId); if (updated) await writeAudit({ event: 'GUARDIAN_APPROVED', actor_id: identity.account_id, details: accountId }); return updated ? res.json({ approved: true }) : res.status(404).json({ error: 'Pending guardian request not found.' }); }
  catch (error) { return res.status(503).json({ error: error.message }); }
});

app.get('/auth/twitch', async (_req, res) => {
  if (!twitch.configured()) return res.status(503).send('Twitch OAuth is not configured. Set backend Twitch credentials.');
  const state = await twitch.createLoginState();
  res.cookie(oauthStateCookie, state, { httpOnly: true, sameSite: 'lax', secure: parsedAllowedOrigin.protocol === 'https:', maxAge: 10 * 60 * 1000, path: '/auth/twitch/callback' });
  res.redirect(twitch.loginUrl(state));
});

app.get('/auth/twitch/callback', async (req, res) => {
  const state = String(req.query.state || '');
  const validState = await twitch.consumeLoginState(state, getCookie(req, oauthStateCookie));
  res.clearCookie(oauthStateCookie, { httpOnly: true, sameSite: 'lax', secure: parsedAllowedOrigin.protocol === 'https:', path: '/auth/twitch/callback' });
  if (!validState) return res.status(400).send('Invalid or expired Twitch authorization state.');
  if (req.query.error || typeof req.query.code !== 'string') return res.status(400).send('Twitch authorization was not completed.');
  try {
    const result = await twitch.finishLogin(req.query.code);
    res.cookie(sessionCookie, result.session, { httpOnly: true, sameSite: sessionCookieSameSite, secure: parsedAllowedOrigin.protocol === 'https:', maxAge: twitchAccountStore.durable ? 10 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000, path: '/' });
    res.redirect(allowedOrigin);
  } catch (error) { log('error', 'twitch_login_failed', { request_id: req.id, error: error.message }); res.status(502).send('Twitch login failed.'); }
});

app.get('/api/twitch/session', async (req, res) => {
  const user = await getTwitchUser(req);
  const connection = user && twitch.connections.get(user.id);
  return res.json({ user, eventsub_status: connection?.ready ? 'connected' : user ? 'connecting' : 'disconnected' });
});
app.post('/auth/twitch/logout', async (req, res) => {
  const parsed = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${sessionCookie}=`));
  if (parsed) {
    try {
      const session = decodeURIComponent(parsed.slice(sessionCookie.length + 1));
      const user = await twitch.sessionAsync(session);
      await twitch.logout(session);
      if (user) { streamerLocations.delete(user.id); if (redis) await redis.del(`fule:streamer-location:${user.id}`); }
    } catch { /* Ignore malformed cookie values. */ }
  }
  res.clearCookie(sessionCookie, { httpOnly: true, sameSite: sessionCookieSameSite, secure: parsedAllowedOrigin.protocol === 'https:', path: '/' }); res.json({ ok: true });
});
app.post('/api/streamer/location', async (req, res) => {
  const streamer = await getTwitchUser(req); if (!streamer) return res.status(401).json({ error: 'Twitch streamer login required.' });
  const validated = validateSosPayload({ streamer_id: streamer.id, location: req.body?.location, module_type: 'FULE_PROTECT', source: 'button' });
  if (!validated.ok) return res.status(400).json({ error: validated.error });
  await saveStreamerLocation(streamer.id, validated.value.location);
  while (streamerLocations.size > 2_000) streamerLocations.delete(streamerLocations.keys().next().value);
  return res.json({ ok: true });
});

app.post('/api/guardians/verify', requestLimit({ limit: 8, windowMs: 60_000 }), (req, res) => {
  if (!demoMode) return res.status(410).json({ error: 'Invite verification is disabled. Register, request guardian status, and wait for administrator approval.' });
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  if (!consumeInviteAttempt(key)) { res.set('Retry-After', '60'); return res.status(429).json({ error: 'Too many invite attempts. Try again in one minute.' }); }
  const verified = verifyGuardianInvite(req.body?.invite_code, { allowDemo: demoMode });
  if (!verified) return res.status(401).json({ error: 'Invalid or inactive guardian invite.' });
  return res.json(verified);
});

app.get('/api/incidents', requestLimit({ limit: 60, windowMs: 60_000 }), async (req, res) => {
  const guardian = getGuardian(req);
  if (!guardian) return res.status(403).json({ error: 'Verified guardian access required.' });
  const limit = req.query?.limit === undefined ? 100 : Number(req.query.limit);
  const offset = req.query?.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return res.status(400).json({ error: 'limit must be 1–100 and offset a non-negative integer.' });
  const page = await listIncidentPage({ limit, offset });
  return res.json({ incidents: page.map(({ streamer_id, ...incident }) => incident), guardian_id: guardian.guardian_id, limit, offset });
});

app.get('/api/streamer/trusted-contacts', requestLimit({ limit: 30, windowMs: 60_000 }), async (req, res) => {
  const identity = await getStreamerIdentity(req, req.query?.streamer_id);
  if (!identity) return res.status(401).json({ error: 'Connect your Twitch account to manage trusted contacts.' });
  return res.json({ contacts: await loadTrustedContactsFresh(identity.id) });
});

app.put('/api/streamer/trusted-contacts', requestLimit({ limit: 10, windowMs: 60_000 }), async (req, res) => {
  const identity = await getStreamerIdentity(req, req.body?.streamer_id);
  if (!identity) return res.status(401).json({ error: 'Connect your Twitch account to manage trusted contacts.' });
  const contacts = req.body?.contacts;
  if (!Array.isArray(contacts) || contacts.length > 3) return res.status(400).json({ error: 'Add no more than three trusted contacts.' });
  const normalized = [];
  for (const contact of contacts) {
    const name = typeof contact?.name === 'string' ? contact.name.trim().slice(0, 80) : '';
    const phone = typeof contact?.phone === 'string' ? contact.phone.trim() : '';
    if (!name || !/^\+[1-9]\d{7,14}$/.test(phone)) return res.status(400).json({ error: 'Each contact needs a name and an E.164 phone number, such as +14155550123.' });
    normalized.push({ name, phone });
  }
  await saveTrustedContacts(identity.id, normalized);
  await flushIncidentWrites();
  writeAudit({ event: 'TRUSTED_CONTACTS_UPDATED', actor_id: identity.id, details: `${normalized.length} trusted contact(s) saved.` });
  return res.json({ contacts: normalized });
});

function mayAccessDispatch(req) { return Boolean(getGuardian(req) || (demoMode && isLoopbackRequest(req))); }

app.get('/api/dispatch/queue', requestLimit({ limit: 60, windowMs: 60_000 }), async (req, res) => {
  if (!mayAccessDispatch(req)) return res.status(403).json({ error: 'Verified guardian or local demo access required.' });
  const queue = (await listDispatchQueue({ limit: 100 })).map(({ streamer_id, ...incident }) => incident);
  return res.json({ simulated: demoMode, incidents: queue });
});

app.post('/api/dispatch/:incidentId/action', requestLimit({ limit: 60, windowMs: 60_000 }), async (req, res) => {
  if (!mayAccessDispatch(req)) return res.status(403).json({ error: 'Verified guardian or local demo access required.' });
  const incidentId = String(req.params.incidentId || '');
  const action = String(req.body?.action || '').toUpperCase();
  const actor = getGuardian(req)?.guardian_id || 'demo-dispatch-console';
  if (action === 'STAND_DOWN') {
    const updated = await standDownDispatch(incidentId, String(req.body?.reason || 'Dispatch control room stand-down.'), actor);
    return updated ? res.json({ incident: updated }) : res.status(409).json({ error: 'Dispatch has not been sent or stand-down failed.' });
  }
  if (!['ACCEPT', 'EN_ROUTE', 'RESOLVED'].includes(action)) return res.status(400).json({ error: 'action must be ACCEPT, EN_ROUTE, RESOLVED, or STAND_DOWN.' });
  const updated = await updateDispatchStage(incidentId, action === 'ACCEPT' ? 'ACCEPTED' : action, actor);
  return updated ? res.json({ incident: updated }) : res.status(409).json({ error: 'Incident is not available for dispatch status update.' });
});

app.post('/api/sos', requestLimit({ limit: Number(process.env.FULE_SOS_IP_LIMIT) || 6, windowMs: 60_000 }), async (req, res) => {
  const user = await getTwitchUser(req);
  const loadTestAuthorized = demoMode && Boolean(loadTestTokenHash) && tokenMatches(req.get('x-fule-load-test-token'), loadTestTokenHash);
  const authenticatedStreamer = user && req.body?.streamer_id === user.id;
  if (!authenticatedStreamer && !loadTestAuthorized && !(demoMode && isLoopbackRequest(req))) return res.status(401).json({ error: 'Sign in with the matching Twitch streamer account to trigger SOS.' });
  const source = req.body?.source || 'button';
  if (source !== 'button' && !(demoMode && isLoopbackRequest(req))) return res.status(400).json({ error: 'Chat and redeem incidents must come from verified Twitch EventSub events.' });
  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  if (idempotencyKey && !/^[\w:.-]{8,180}$/.test(idempotencyKey)) return res.status(400).json({ error: 'Idempotency-Key must contain 8–180 safe characters.' });
  try {
    const scopedKey = idempotencyKey ? `${req.body?.streamer_id}:${idempotencyKey}`.slice(0, 200) : '';
    if (scopedKey && incidentRepository.db) {
      const existing = await incidentRepository.db('idempotency_keys').where({ key: scopedKey }).first();
      if (existing) return res.status(200).json(existing.response);
    }
    if (scopedKey && memoryIdempotency.has(scopedKey)) return res.status(200).json(memoryIdempotency.get(scopedKey));
    const result = await createSosIncident(req.body);
    if (result.status === 201 && scopedKey) {
      memoryIdempotency.set(scopedKey, result.body);
      if (incidentRepository.db) await incidentRepository.db('idempotency_keys').insert({ key: scopedKey, streamer_id: req.body.streamer_id, incident_id: result.body.incident.incident_id, response: JSON.stringify(result.body) }).onConflict('key').ignore();
    }
    await flushIncidentWrites();
    return res.status(result.status).json(result.body);
  }
  catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An active incident already exists for this streamer.' });
    Sentry.captureException(error); log('error', 'sos_create_failed', { request_id: req.id, error: error.message });
    return res.status(500).json({ error: 'Could not create incident. Please retry.' });
  }
});

io.on('connection', (socket) => {
  const address = socket.handshake.address || 'unknown';
  const connected = socketConnectionsByIp.get(address) || 0;
  if (connected >= (Number(process.env.SOCKETS_PER_IP_LIMIT) || 2_000)) { socket.disconnect(true); return; }
  socketConnectionsByIp.set(address, connected + 1);
  activeSockets.set(io.engine.clientsCount);
  socket.on('disconnect', () => {
    const remaining = Math.max(0, (socketConnectionsByIp.get(address) || 1) - 1);
    if (remaining) socketConnectionsByIp.set(address, remaining); else socketConnectionsByIp.delete(address);
    activeSockets.set(io.engine.clientsCount);
  });
  if (socket.data.role === 'guardian') {
    socket.join('guardians');
    const expirationTimer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.guardianExpiresAt - Date.now()));
    expirationTimer.unref?.();
    socket.on('disconnect', () => clearTimeout(expirationTimer));
  } else socket.join('public');
  if ((demoMode && isLoopbackAddress(socket.handshake.address)) || socket.data.role === 'guardian') socket.join('dispatch');
  socket.emit('fule:access', { role: socket.data.role, guardian_id: socket.data.guardianId || null });

  socket.on('register_streamer', async (payload = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || socket.data.streamerIncidentId) return;
    const { incident_id, streamer_id, cancel_token } = payload;
    const incident = await getIncident(String(incident_id || ''));
    const credentials = await loadCancelCredential(String(incident_id || ''));
    if (!incident || !['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status) || ['SENT', 'ACKNOWLEDGED'].includes(incident.dispatch_record?.status) || !credentials || credentials.streamer_id !== streamer_id || !tokenMatches(cancel_token, credentials.token_hash)) {
      socket.emit('streamer_registration_failed', { incident_id: incident_id || null });
      return;
    }
    socket.data.streamerIncidentId = incident.incident_id;
    socket.data.streamerId = streamer_id;
    socket.join(`streamer:${incident.incident_id}`);
    socket.emit('streamer_registered', { incident_id: incident.incident_id });
  });

  socket.on('acknowledge_incident', async (incidentId) => {
    if (socket.data.role !== 'guardian' || !socket.data.guardianId) return;
    if (typeof incidentId !== 'string' || incidentId.length > 128) return;
    const current = await getIncident(String(incidentId));
    if (!current || !['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(current.status)) return;
    clearIncidentTimers(current.incident_id);
    try {
      const acknowledged = await changeIncident(current.incident_id, {
        status: 'ACKNOWLEDGED', acknowledged_by: socket.data.guardianId,
        acknowledged_at: new Date().toISOString(),
        guardian_responses: [...(current.guardian_responses || []), { guardian_id: socket.data.guardianId, at: new Date().toISOString(), action: 'ACKNOWLEDGED' }]
      }, { event: 'INCIDENT_ACKNOWLEDGED', actorId: socket.data.guardianId });
      emitIncidentUpdate(acknowledged, 'incident_acknowledged');
      // Keep the streamer capability while dispatch is only queued so the
      // originator can still cancel before a provider reports SENT.
    } catch (error) {
      log('error', 'incident_acknowledgement_failed', { incident_id: current.incident_id, error: error.message });
    }
  });

  const handleStreamerCancellation = (eventName, status) => async (payload = {}) => {
    const incidentId = socket.data.streamerIncidentId;
    const current = incidentId && await getIncident(incidentId);
    const credentials = incidentId && await loadCancelCredential(incidentId);
    if (!current || !credentials || socket.data.streamerId !== credentials.streamer_id || payload.incident_id !== incidentId) return;
    if (['SENT', 'ACKNOWLEDGED'].includes(current.dispatch_record?.status)) {
      socket.emit('streamer_action_rejected', { incident_id: incidentId, reason: 'Dispatch has been sent. Use Stand down to notify the dispatch provider.' });
      return;
    }
    clearIncidentTimers(incidentId);
    try {
      const falseAlarmCount = status === 'FALSE_ALARM' ? await recordFalseAlarm(socket.data.streamerId) : null;
      const cancelled = await changeIncident(incidentId, { status, repeat_offender: falseAlarmCount != null && falseAlarmCount >= 3 }, {
        event: eventName.toUpperCase(), actorId: socket.data.streamerId,
        details: falseAlarmCount == null ? 'Streamer cancelled before dispatch was sent.' : `False alarm count: ${falseAlarmCount}${falseAlarmCount >= 3 ? '; repeat-offender flag set.' : ''}`
      });
      await deleteCancelCredential(incidentId);
      emitIncidentUpdate(cancelled, 'sos_cancelled');
      socket.emit('streamer_action_confirmed', { incident_id: incidentId, status });
    } catch (error) {
      log('error', 'incident_cancellation_failed', { incident_id: incidentId, error: error.message });
    }
  };

  socket.on('false_alarm', handleStreamerCancellation('false_alarm', 'FALSE_ALARM'));
  socket.on('cancel_sos', handleStreamerCancellation('cancel_sos', 'CANCELLED'));
  socket.on('stand_down', async ({ incident_id, reason } = {}) => {
    const incident = typeof incident_id === 'string' ? await getIncident(incident_id) : null;
    const authorized = (socket.data.role === 'guardian' && socket.data.guardianId)
      || (socket.data.streamerIncidentId === incident_id && incident?.streamer_id === socket.data.streamerId);
    if (!authorized || typeof incident_id !== 'string') return;
    const updated = await standDownDispatch(incident_id, String(reason || '').slice(0, 250), socket.data.guardianId || socket.data.streamerId);
    if (!updated) socket.emit('streamer_action_rejected', { incident_id, reason: 'Could not send stand-down to dispatch.' });
  });
});

if (typeof Sentry.setupExpressErrorHandler === 'function') Sentry.setupExpressErrorHandler(app);

await startBackgroundWorkers({
  onContact: contactTrustedPeople,
  onDispatch: (incidentId) => sendToDispatch(incidentId, 'T_PLUS_60'),
  onCleanup: () => cleanupIncidentData(Number(process.env.INCIDENT_RETENTION_DAYS) || 90)
});
await verifyRuntimeInfrastructure();
await twitch.hydrate();

httpServer.listen(port, () => log('info', 'server_listening', { port, mode: demoMode ? 'demo' : 'production', storage: incidentRepository.db ? 'postgresql' : 'file-demo', redis: redisEnabled }));

httpServer.on('error', (error) => {
  if (error.code === 'EADDRINUSE') log('error', 'port_in_use', { port, detail: 'Stop the old FULE server or set PORT in backend/.env.' });
  else log('error', 'server_start_failed', { error: error.message });
  process.exit(1);
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON request.' });
  Sentry.captureException(error);
  log('error', 'request_middleware_error', { request_id: _req.id, error: error.message });
  return res.status(500).json({ error: 'Request could not be processed.' });
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'graceful_shutdown_started', { signal });
  for (const incidentId of timers.keys()) clearIncidentTimers(incidentId);
  await flushIncidentWrites();
  await new Promise((resolve) => io.close(resolve));
  await Promise.allSettled([twitch.shutdown(), closeRuntimeInfrastructure(), closeIncidentStore(), Sentry.flush(2_000)]);
  process.exit(0);
}
process.once('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.once('SIGINT', () => { void gracefulShutdown('SIGINT'); });

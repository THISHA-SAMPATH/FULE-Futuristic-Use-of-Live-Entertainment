import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { INCIDENT_MODULE, createIncident, isIncident, toPublicIncident } from '../shared/incident.mjs';
import { writeAudit } from './services/auditLog.js';
import { provisionalTriage, runTriage, triageHealth } from './services/triageEngine.js';
import { createStreamerRateLimiter, validateSosPayload } from './services/sosValidation.js';
import { incidentRepository, loadIncidents, getIncident as getStoredIncident, listIncidentPage, listDispatchQueue, persistIncident, removeIncident, loadTrustedContactsFresh, saveTrustedContacts, recordFalseAlarm, flushIncidentWrites, cleanupIncidentData, closeIncidentStore } from './services/incidentStore.js';
import { createDispatchProvider, createEmergencyReport } from './services/dispatchBridge.js';
import { createEscalationLadder } from './services/escalationLadder.js';
import { applyButtonTriggerFloor, createDeliveryPlan } from './services/deliveryPolicy.js';
import { notifyTrustedContacts } from './services/trustedContactNotifier.js';
import { authenticateAccess, authenticateTrustedContactStreamToken, createTrustedContactStreamToken, loginAccount, refreshAccount, revokeRefreshToken, registerAccount, requestGuardianApproval, approveGuardian } from './services/accountService.js';
import { redis, redisEnabled, installSocketAdapter, verifyRuntimeInfrastructure, scheduleEscalationJobs, cancelEscalationJobs, scheduleSafeWalkCheckin, scheduleSafeWalkTimeout, cancelSafeWalkJobs, startBackgroundWorkers, closeRuntimeInfrastructure } from './services/runtimeInfrastructure.js';
import { activeSockets, alertDeliveryLatency, httpRequestDuration, httpRequests, log, metricsRegistry, queueDepth, requestContext } from './services/securityMetrics.js';
import { createSafeWalkWorkflow, matchNearbyGuardians, safeWalkTokenMatches } from './services/safetyFeatures.js';
import { safetyFeatureStore } from './services/safetyFeatureStore.js';
import { EvidenceVault } from './services/evidenceVault.js';
import { getWebPushPublicKey, sendSafeWalkPush } from './services/webPushNotifier.js';
import { createTieredRateLimiter } from './services/tieredRateLimiter.js';
import { buildDegradedSnapshot } from './services/degradedModes.js';
import { validateJsonValue } from './services/requestValidation.js';
import { createLiveStreamService } from './services/liveStreamService.js';

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
const tieredDeliveryEnabled = process.env.FULE_TIERED_DELIVERY === 'true';
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production.');
if (process.env.NODE_ENV === 'production' && !process.env.METRICS_TOKEN) throw new Error('METRICS_TOKEN is required in production.');
if (process.env.NODE_ENV === 'production' && Buffer.from(process.env.EVIDENCE_ENCRYPTION_KEY || '', 'base64').length !== 32) throw new Error('EVIDENCE_ENCRYPTION_KEY must be base64 encoded 32 random bytes in production.');
const dispatchProvider = createDispatchProvider();
const parsedAllowedOrigin = new URL(allowedOrigin);
if (!['http:', 'https:'].includes(parsedAllowedOrigin.protocol) || parsedAllowedOrigin.origin !== allowedOrigin) {
  throw new Error('FRONTEND_ORIGIN must be a single HTTP(S) origin without a path.');
}
if (!demoMode && parsedAllowedOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsedAllowedOrigin.hostname)) {
  throw new Error('Non-demo deployments must use an HTTPS FRONTEND_ORIGIN.');
}

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
const volatileIncidents = new Map();
let databaseDegraded = false;
const cancelCredentials = new Map();
const timers = new Map();
const streamerLocations = new Map();
const loadTestTokenHash = process.env.FULE_LOAD_TEST_TOKEN ? hashToken(process.env.FULE_LOAD_TEST_TOKEN).toString('hex') : '';
const tieredLimiter = createTieredRateLimiter({ redis });
const creatingIncidents = new Set();
const memoryIdempotency = new Map();
const creatingIdempotency = new Map();
const socketConnectionsByIp = new Map();
const socketAttemptsByIp = new Map();
let incidentTransitionQueue = Promise.resolve();

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
    const durationMs = Number(process.hrtime.bigint() - req._startedAt) / 1e6;
    const route = String(req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path).replace(/[\w-]{30,}/g, ':id').slice(0, 160);
    httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    httpRequestDuration.observe({ method: req.method, route, status: String(res.statusCode) }, durationMs / 1000);
    const fields = { request_id: req.id, method: req.method, route, status: res.statusCode, duration_ms: Number(durationMs.toFixed(2)), taxonomy: res.statusCode >= 500 ? 'internal' : res.statusCode >= 400 ? 'client' : 'none' };
    log(res.statusCode >= 500 ? 'error' : 'info', 'http_request', fields);
    if (durationMs >= (Number(process.env.SLOW_REQUEST_MS) || 500)) log('warn', 'slow_request', fields);
  });
  req._startedAt = process.hrtime.bigint();
  requestContext.run({ request_id: req.id }, next);
});
app.use(cors({
  origin(origin, callback) {
    return callback(null, isAllowedOrigin(origin) ? origin || false : false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Streamer-Evidence-Token', 'X-Safe-Walk-Token', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit-Limit'],
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
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self)',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin'
  });
  if (req.secure || parsedAllowedOrigin.protocol === 'https:') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '32kb', strict: true, type: 'application/json', verify(req, _res, buffer) { if (req.path === '/api/livekit/webhook') req.rawBody = buffer.toString('utf8'); } }));
app.use((req, res, next) => {
  if (!req.is('application/json') || req.body == null) return next();
  const validation = validateJsonValue(req.body);
  if (!validation.valid) return res.status(400).json({ error: validation.error });
  return next();
});

const evidenceVault = new EvidenceVault({ directory: process.env.EVIDENCE_STORAGE_DIR || './data/evidence', store: safetyFeatureStore });
const liveStreamService = createLiveStreamService({ evidenceVault, evidenceStore: safetyFeatureStore });

function enforceRequestSafety(req, res, next) {
  const origin = req.get('Origin');
  if (!isAllowedOrigin(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  const type = req.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  const evidenceUpload = req.method === 'POST' && /^\/api\/incidents\/[\w.-]+\/evidence$/.test(req.path) && /^(audio|video)\/(webm|mp4|ogg|mpeg)$/.test(type || '');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && type !== 'application/json' && !evidenceUpload) {
    return res.status(415).json({ error: 'Requests must use application/json.' });
  }
  next();
}

function requestLimit({ limit, windowMs, global = false }) {
  return async (req, res, next) => {
    const account = authenticateAccess(getBearerToken(req));
    const streamerId = typeof req.body?.streamer_id === 'string' ? req.body.streamer_id : null;
    const route = `${req.baseUrl}${req.path}`.replace(/[\w-]{30,}/g, ':id') + `:${limit}:${windowMs}`;
    try {
      const result = await tieredLimiter.consume({ ip: req.ip || req.socket.remoteAddress || 'unknown', user: account?.account_id || streamerId, route }, global
        ? { perIp: limit, windowMs }
        : { perUser: Math.max(limit, Number(process.env.FULE_USER_ROUTE_LIMIT) || limit * 2), perRoute: limit, windowMs });
      if (!result.allowed) { res.set('Retry-After', String(Math.ceil(result.retry_after_ms / 1000))); return res.status(429).json({ error: 'Request rate limit exceeded.', scope: result.scope }); }
      res.set('RateLimit-Limit', String(limit));
      return next();
    } catch (error) {
      log('error', 'rate_limit_backend_failed', { request_id: req.id, error: error.message, taxonomy: 'dependency' });
      if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Rate limiting service unavailable.' });
      return next();
    }
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
app.use('/api', requestLimit({ limit: Number(process.env.FULE_API_IP_LIMIT) || 180, windowMs: 60_000, global: true }));
app.use('/auth', requestLimit({ limit: Number(process.env.FULE_AUTH_IP_LIMIT) || 120, windowMs: 60_000, global: true }));
app.use('/api', requestLimit({ limit: Number(process.env.FULE_DEFAULT_ROUTE_LIMIT) || 600, windowMs: 60_000 }));

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
  const account = authenticateAccess(getBearerToken(request));
  if (!account || !['guardian', 'admin'].includes(account.role)) return null;
  return { guardian_id: account.account_id, role: account.role, expires_at: account.expires_at };
}

function requireRoles(...roles) {
  return (req, res, next) => {
    const token = getBearerToken(req);
    const guardian = token ? getGuardian(req) : null;
    const account = token ? authenticateAccess(token) : null;
    if (token && !guardian && !account) return res.status(401).json({ error: 'Authentication token is invalid or expired.' });
    const role = guardian ? guardian.role || 'guardian' : account?.role;
    if (!role) return res.status(token ? 401 : 403).json({ error: token ? 'Authentication token is invalid or expired.' : 'Verified guardian access required.' });
    if (!roles.includes(role)) return res.status(403).json({ error: 'This role is not authorized for the requested resource.' });
    req.identity = account || guardian;
    req.guardianIdentity = guardian;
    return next();
  };
}

async function getIncident(incidentId) { return volatileIncidents.get(incidentId) || getStoredIncident(incidentId); }

async function withDeadline(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { const error = new Error(`${label} deadline exceeded`); error.code = 'DEPENDENCY_TIMEOUT'; reject(error); }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function getStreamerIdentity(req, suppliedId = '') {
  const account = authenticateAccess(getBearerToken(req));
  if (account && ['user', 'guardian', 'admin'].includes(account.role)) return { id: account.account_id, user: { id: account.account_id, display_name: account.email || 'FULE member', role: account.role } };
  if (demoMode && isLoopbackRequest(req) && typeof suppliedId === 'string' && suppliedId.trim()) return { id: suppliedId.trim().slice(0, 128), user: null };
  return null;
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

function changeIncident(incidentId, patch, options = {}) {
  const operation = incidentTransitionQueue.catch(() => {}).then(() => changeIncidentAtomic(incidentId, patch, options));
  incidentTransitionQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function changeIncidentAtomic(incidentId, patch, { event, actorId, details, expectedStatuses } = {}) {
  let current;
  let updated;
  if (volatileIncidents.has(incidentId)) {
    current = volatileIncidents.get(incidentId);
    if (expectedStatuses && !expectedStatuses.includes(current.status)) return null;
    updated = createIncident({ ...current, ...patch });
    if (current.streamer_id) updated.streamer_id = current.streamer_id;
    if (!isIncident(updated)) throw new Error('Incident state failed schema validation');
    volatileIncidents.set(incidentId, updated);
    incidents.set(incidentId, updated);
    await writeStateChange({ incident: updated, event, fromStatus: current.status, toStatus: updated.status, actorId, details });
  } else if (incidentRepository.db && !databaseDegraded) {
    await incidentRepository.db.transaction(async (transaction) => {
      const row = await transaction('incidents').where({ incident_id: incidentId }).forUpdate().first('payload', 'streamer_id');
      if (!row) return;
      current = { ...createIncident(row.payload), ...(row.streamer_id ? { streamer_id: row.streamer_id } : {}) };
      if (expectedStatuses && !expectedStatuses.includes(current.status)) return;
      updated = createIncident({ ...current, ...patch });
      if (current.streamer_id) updated.streamer_id = current.streamer_id;
      if (!isIncident(updated)) throw new Error('Incident state failed schema validation');
      const changed = await transaction('incidents').where({ incident_id: incidentId, status: current.status }).update({ created_at: new Date(updated.created_at), status: updated.status, streamer_id: updated.streamer_id || '', payload: JSON.stringify(updated) });
      if (!changed) { updated = null; return; }
      await transaction('audit_events').insert({
        event: event || 'STATE_CHANGE', incident_id: incidentId, actor_id: actorId || null,
        payload: JSON.stringify({ at: new Date().toISOString(), event, incident_id: incidentId, from_status: current.status, to_status: updated.status, actor_id: actorId || null, details: details || null }),
        created_at: new Date()
      });
    });
  } else {
    current = await getIncident(incidentId);
    if (!current) return null;
    if (expectedStatuses && !expectedStatuses.includes(current.status)) return null;
    updated = createIncident({ ...current, ...patch });
    if (current.streamer_id) updated.streamer_id = current.streamer_id;
    if (!isIncident(updated)) throw new Error('Incident state failed schema validation');
    await writeStateChange({ incident: updated, event, fromStatus: current.status, toStatus: updated.status, actorId, details });
    await persistIncident(updated);
  }
  if (!updated) return null;
  incidents.set(incidentId, updated);
  if (['CANCELLED', 'FALSE_ALARM', 'RESOLVED'].includes(updated.status) || updated.dispatch_stage === 'STAND_DOWN') {
    void liveStreamService.revokeIncident(incidentId).then(() => writeAudit({ event: 'LIVEKIT_ACCESS_REVOKED', incident_id: incidentId, actor_id: actorId || 'system', details: 'Incident closed; room participants and room access revoked.' }))
      .catch((error) => log('error', 'livekit_revocation_failed', { incident_id: incidentId, taxonomy: 'dependency', error: error.message }));
  }
  return updated;
}

async function acknowledgeIncident(incidentId, guardianId) {
  const current = await getIncident(incidentId);
  if (!current) return { ok: false, status: 404, error: 'Incident not found.' };
  if (await safetyFeatureStore.guardianHasPendingOffer(current.incident_id, guardianId)) return { ok: false, status: 403, error: 'Accept the nearby response request before acknowledging.' };
  const acknowledgedAt = new Date().toISOString();
  const updated = await changeIncident(current.incident_id, {
    status: 'ACKNOWLEDGED', acknowledged_by: guardianId, acknowledged_at: acknowledgedAt,
    guardian_responses: [...(current.guardian_responses || []), { guardian_id: guardianId, at: acknowledgedAt, action: 'ACKNOWLEDGED' }]
  }, { event: 'INCIDENT_ACKNOWLEDGED', actorId: guardianId, expectedStatuses: ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'] });
  if (!updated) return { ok: false, status: 409, error: 'Incident already acknowledged or no longer active.' };
  clearIncidentTimers(current.incident_id);
  await emitIncidentUpdate(updated, 'incident_acknowledged');
  return { ok: true, incident: updated };
}

async function emitIncidentUpdate(incident, eventName) {
  await flushIncidentWrites();
  const offers = await safetyFeatureStore.nearbyOfferStates(incident.incident_id).catch(() => []);
  const pending = offers.filter((offer) => !offer.accepted_at);
  const restrictedRooms = pending.map((offer) => `guardian:${offer.guardian_id}`);
  const guardians = io.to('guardians');
  const dispatch = io.to('dispatch');
  if (restrictedRooms.length) { guardians.except(restrictedRooms).emit(eventName, incident); dispatch.except(restrictedRooms).emit(eventName, incident); }
  else { guardians.emit(eventName, incident); dispatch.emit(eventName, incident); }
  for (const offer of pending) io.to(`guardian:${offer.guardian_id}`).emit(eventName, toPublicIncident(incident));
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
    try {
      const streamLinks = {};
      for (const contact of contacts) {
        const token = createTrustedContactStreamToken({ incidentId, streamerId: current.streamer_id, contactEmail: contact.email });
        streamLinks[contact.email] = `${allowedOrigin}/?fuleIncident=${encodeURIComponent(incidentId)}#fuleStream=${encodeURIComponent(token)}`;
      }
      result = await notifyTrustedContacts({ contacts, incident: current, streamLinks });
    }
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
  const report = createEmergencyReport(current, {
    streamerContact: current.streamer_contact,
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
    await emitIncidentUpdate(escalated, 'incident_escalated');
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
    await emitIncidentUpdate(failed, 'incident_escalated');
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
    risk_level: payload.risk_level,
    location: {
      lat: Number.isFinite(payload.location.lat) ? Math.round(payload.location.lat * 100) / 100 : null,
      lng: Number.isFinite(payload.location.lng) ? Math.round(payload.location.lng * 100) / 100 : null
    }
  };
  const rawSynthesis = provisionalTriage(synthesisInput);
  const initialThreatLevel = applyButtonTriggerFloor({ source: payload.source, threat_level: rawSynthesis.threat_level });
  const synthesis = initialThreatLevel === rawSynthesis.threat_level ? rawSynthesis : {
    ...rawSynthesis, threat_level: initialThreatLevel, recommended_action: 'ALERT_GUARDIANS_AND_CALL_112'
  };
  const deliveryPlan = createDeliveryPlan({ threat_level: synthesis.threat_level, tieredEnabled: tieredDeliveryEnabled });
  let incident = createIncident({
    incident_id: `sos-${activatedAt}-${randomBytes(4).toString('hex')}`, threat_level: synthesis.threat_level,
    module: payload.module_type, location: payload.location, summary: synthesis.summary,
    recommended_action: synthesis.recommended_action, status: deliveryPlan.route === 'log_only' ? 'RESOLVED' : 'PENDING_DISPATCH', created_at: new Date(activatedAt).toISOString(),
    source: payload.source, stream_url: null, button_policy_floor: initialThreatLevel !== rawSynthesis.threat_level,
    transcript_snippet: payload.audio_transcript_snippet,
    streamer_contact: { streamer_id: payload.streamer_id, display_name: demoMode ? 'Demo Streamer' : 'FULE member' },
    dispatch_stage: 'GUARDIANS'
  });
  if (!isIncident(incident)) return { status: 500, body: { error: 'Incident failed schema validation.' } };
  const cancelToken = randomBytes(32).toString('base64url');
  const contactsDelayMs = Number(process.env.FULE_CONTACTS_DELAY_MS) || 30_000;
  const dispatchDelayMs = Number(process.env.FULE_DISPATCH_DELAY_MS) || Number(process.env.FULE_ESCALATION_DELAY_MS) || 60_000;
  const persistedIncident = { ...incident, streamer_id: payload.streamer_id };
  const cancelCredential = { streamer_id: payload.streamer_id, token_hash: hashToken(cancelToken).toString('hex') };
  if (incidentRepository.db && !databaseDegraded) {
    const persist = incidentRepository.db.transaction(async (transaction) => {
      await transaction('incidents').insert({ incident_id: incident.incident_id, created_at: new Date(incident.created_at), status: incident.status, streamer_id: payload.streamer_id, payload: JSON.stringify(persistedIncident) });
      await transaction('audit_events').insert({ event: 'SOS_CREATED', incident_id: incident.incident_id, actor_id: payload.streamer_id, payload: JSON.stringify({ at: new Date().toISOString(), event: 'SOS_CREATED', incident_id: incident.incident_id, from_status: null, to_status: incident.status, actor_id: payload.streamer_id }), created_at: new Date() });
      await transaction('streamer_incident_sessions').insert({ incident_id: incident.incident_id, streamer_id: payload.streamer_id, token_hash: cancelCredential.token_hash, expires_at: new Date(Date.now() + 7 * 86_400_000) });
    });
    try {
      await withDeadline(persist, Number(process.env.FULE_DB_SOS_DEADLINE_MS) || 1500, 'incident database write');
      cancelCredentials.set(incident.incident_id, cancelCredential);
    } catch (error) {
      if (['DEPENDENCY_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01'].includes(error.code) || String(error.code || '').startsWith('08')) {
        databaseDegraded = true;
        volatileIncidents.set(incident.incident_id, persistedIncident);
        cancelCredentials.set(incident.incident_id, cancelCredential);
        incidents.set(incident.incident_id, persistedIncident);
        writeAudit({ event: 'INCIDENT_VOLATILE_STORAGE_FALLBACK', incident_id: incident.incident_id, actor_id: 'system', details: error.message });
        log('error', 'database_degraded_alert_volatile', { incident_id: incident.incident_id, taxonomy: 'dependency', error: error.message });
      } else throw error;
    }
  } else {
    await persistIncident(persistedIncident);
    await writeStateChange({ incident, event: 'SOS_CREATED', fromStatus: null, toStatus: incident.status, actorId: payload.streamer_id });
    await saveCancelCredential(incident.incident_id, cancelCredential);
  }
  incidents.set(incident.incident_id, persistedIncident);
  await flushIncidentWrites();
  if (deliveryPlan.notify_trusted_circle_now) {
    await contactTrustedPeople(incident.incident_id);
    incident = createIncident(incidents.get(incident.incident_id) || incident);
  }
  if (deliveryPlan.route === 'log_only') {
    await writeAudit({ event: 'LOW_TRIAGE_LOGGED', incident_id: incident.incident_id, actor_id: 'system', details: 'Tiered delivery is enabled; LOW incident recorded without notifications.' });
  }
  const broadcastStarted = process.hrtime.bigint();
  let nearbyOffered = 0;
  let nearbyResponders = [];
  if (deliveryPlan.notify_guardians) {
    try { nearbyResponders = await notifyNearbyGuardians(incident); nearbyOffered = nearbyResponders.length; }
    catch (error) { log('error', 'nearby_guardian_matching_failed', { incident_id: incident.incident_id, error: error.message }); }
  }
  const proximityRooms = nearbyResponders.map((responder) => `guardian:${responder.guardian_id}`);
  if (deliveryPlan.notify_guardians) {
    if (proximityRooms.length) io.to('guardians').except(proximityRooms).emit('sos_activated', { ...incident, grace_period_seconds: 10 });
    else io.to('guardians').emit('sos_activated', { ...incident, grace_period_seconds: 10 });
    for (const responder of nearbyResponders) io.to(`guardian:${responder.guardian_id}`).emit('sos_activated', { ...toPublicIncident(incident), grace_period_seconds: 10 });
  }
  if (!input.silent_public && deliveryPlan.route !== 'log_only') io.to('public').emit('incident:public', toPublicIncident(incident));
  alertDeliveryLatency.observe(Number(process.hrtime.bigint() - broadcastStarted) / 1e9);
  try { if (deliveryPlan.schedule_escalation) await scheduleDispatch(incident, { contactsDelayMs, dispatchDelayMs }); }
  catch (error) {
    log('error', 'durable_escalation_queue_unavailable_using_local_timer', { incident_id: incident.incident_id, taxonomy: 'dependency', error: error.message });
    databaseDegraded = databaseDegraded || Boolean(incidentRepository.db);
    const scheduled = createEscalationLadder({
      incident, contactsDelayMs, dispatchDelayMs,
      criticalDispatchDelayMs: incident.button_policy_floor ? Math.max(0, Number(process.env.FULE_BUTTON_DISPATCH_GRACE_MS) || 10_000) : 0,
      isAcknowledged: () => incidents.get(incident.incident_id)?.status === 'ACKNOWLEDGED',
      isCancelled: () => ['CANCELLED','FALSE_ALARM','RESOLVED'].includes(incidents.get(incident.incident_id)?.status),
      isDispatchSent: () => ['SENT','ACKNOWLEDGED'].includes(incidents.get(incident.incident_id)?.dispatch_record?.status),
      onContacts: () => contactTrustedPeople(incident.incident_id),
      onDispatch: () => sendToDispatch(incident.incident_id, incident.threat_level === 'CRITICAL' ? 'CRITICAL_THREAT' : 'T_PLUS_60')
    });
    timers.set(incident.incident_id, scheduled);
  }
  void runTriage(synthesisInput).then(async (triageResult) => {
    if (!incidents.has(incident.incident_id)) return;
    const current = incidents.get(incident.incident_id);
    const policyThreatLevel = applyButtonTriggerFloor({ source: current.source, threat_level: triageResult.threat_level, status: current.status });
    const safeTriageResult = policyThreatLevel === triageResult.threat_level ? triageResult : { ...triageResult, threat_level: policyThreatLevel, recommended_action: 'ALERT_GUARDIANS_AND_CALL_112' };
    const updated = await changeIncident(incident.incident_id, safeTriageResult, { event: 'TRIAGE_UPDATED', actorId: 'system' });
    void emitIncidentUpdate(updated, 'incident_updated');
  }).catch((error) => log('error', 'incident_synthesis_update_failed', { incident_id: incident.incident_id, error: error.message }));
  return { status: 201, body: { incident, streamer_cancel_token: cancelToken, nearby_offered_count: nearbyOffered, nearby_accepted_count: 0 } };
  } finally {
    creatingIncidents.delete(payload.streamer_id);
  }
}

const safeWalkWorkflow = createSafeWalkWorkflow({
  store: safetyFeatureStore,
  queue: {
    scheduleCheckin: scheduleSafeWalkCheckin,
    scheduleTimeout: scheduleSafeWalkTimeout,
    cancelWalkJobs: cancelSafeWalkJobs
  },
  notify: async (walk, message) => {
    io.to(`safe-walk:${walk.walk_id}`).emit(message.event, { walk_id: walk.walk_id, ...message });
    if (message.event === 'safe_walk_checkin_due') void sendSafeWalkPush(walk.streamer_id, message);
  },
  triggerSos: async (payload) => {
    const result = await createSosIncident({ ...payload, module_type: 'FULE_PROTECT', location: { lat: payload.location?.lat, lng: payload.location?.lng, address: payload.location?.address || 'Safe-walk last known location' } });
    if (result.status === 201) return result.body;
    if (result.status === 409) {
      const existing = incidentRepository.db
        ? await incidentRepository.db('incidents').select('payload', 'streamer_id').where({ streamer_id: payload.streamer_id }).whereIn('status', ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED']).orderBy('created_at', 'desc').first()
        : [...incidents.values()].find((item) => item.streamer_id === payload.streamer_id && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(item.status));
      if (existing) return { incident: existing.payload ? { ...existing.payload, streamer_id: existing.streamer_id } : existing };
    }
    return null;
  }
});

async function notifyNearbyGuardians(incident) {
  if (!Number.isFinite(incident.location?.lat) || !Number.isFinite(incident.location?.lng)) return [];
  const radiusMeters = Math.max(50, Math.min(5_000, Number(process.env.NEARBY_GUARDIAN_RADIUS_METERS) || 400));
  const limit = Math.max(1, Math.min(20, Number(process.env.NEARBY_GUARDIAN_OFFER_LIMIT) || 10));
  const locations = await safetyFeatureStore.nearbyDutyLocations(incident.location, radiusMeters);
  const responders = matchNearbyGuardians(incident.location, locations, { radiusMeters, limit });
  await safetyFeatureStore.saveNearbyOffers(incident.incident_id, responders);
  for (let index = 0; index < responders.length; index += 1) {
    const responder = responders[index];
    io.to(`guardian:${responder.guardian_id}`).emit('nearby_sos_offer', {
      incident_id: incident.incident_id,
      threat_level: incident.threat_level,
      approximate_area: responder.approximate_area,
      priority: index + 1,
      guidance: 'Observe from a safe distance, call emergency services (112) if needed, and assist only when safe. Never confront.'
    });
  }
  return responders;
}

async function scheduleDispatch(incident, {
  contactsDelayMs = 30_000,
  dispatchDelayMs = 60_000,
  criticalDispatchDelayMs = incident.button_policy_floor ? Math.max(0, Number(process.env.FULE_BUTTON_DISPATCH_GRACE_MS) || 10_000) : 0
} = {}) {
  const incidentId = incident.incident_id;
  if (redisEnabled) {
    await scheduleEscalationJobs(incidentId, { contactsDelayMs, dispatchDelayMs: incident.threat_level === 'CRITICAL' ? criticalDispatchDelayMs : dispatchDelayMs });
    timers.set(incidentId, { cancel: () => { void cancelEscalationJobs(incidentId); } });
    return;
  }
  const scheduled = createEscalationLadder({
    incident,
    contactsDelayMs,
    dispatchDelayMs,
    criticalDispatchDelayMs,
    isAcknowledged: () => incidents.get(incidentId)?.status === 'ACKNOWLEDGED',
    isCancelled: () => ['CANCELLED', 'FALSE_ALARM', 'RESOLVED'].includes(incidents.get(incidentId)?.status),
    isDispatchSent: () => ['SENT', 'ACKNOWLEDGED'].includes(incidents.get(incidentId)?.dispatch_record?.status),
    onContacts: () => contactTrustedPeople(incidentId),
    onDispatch: () => sendToDispatch(incidentId, incident.threat_level === 'CRITICAL' ? 'CRITICAL_THREAT' : 'T_PLUS_60')
  });
  timers.set(incidentId, scheduled);
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
  const token = socket.handshake.auth?.accessToken;
  const account = token ? authenticateAccess(token) : null;
  if (token && !account) return next(new Error('Account session is invalid or expired'));
  if (account && ['guardian', 'admin'].includes(account.role)) {
    socket.data.guardianId = account.account_id;
    socket.data.guardianExpiresAt = account.expires_at;
    socket.data.role = 'guardian';
  } else if (account) {
    socket.data.accountId = account.account_id;
    socket.data.role = account.role;
  } else {
    socket.data.role = 'public';
  }
  next();
});

app.get('/api/health', async (_req, res) => {
  let database = incidentRepository.db ? 'available' : 'demo_file';
  let redisStatus = redisEnabled ? 'available' : 'disabled';
  if (incidentRepository.db) {
    try { await Promise.race([incidentRepository.db.raw('select 1'), new Promise((_, reject) => setTimeout(() => reject(new Error('database health check timed out')), 500))]); }
    catch { database = 'degraded'; }
  }
  if (databaseDegraded) database = 'degraded';
  if (redisEnabled) {
    try { if (await redis.ping() !== 'PONG') redisStatus = 'degraded'; }
    catch { redisStatus = 'degraded'; }
  }
  const snapshot = buildDegradedSnapshot({
    database, redis: redisStatus, triage: triageHealth(),
    dispatch: dispatchProvider.name === 'SimulatedDispatch' ? 'simulated' : dispatchProvider.name === 'UnconfiguredDispatch' ? 'unconfigured' : 'available'
  });
  return res.json(snapshot);
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
app.post('/api/auth/logout', requestLimit({ limit: 20, windowMs: 60_000 }), async (req, res) => {
  try { return res.json({ revoked: await revokeRefreshToken(req.body?.refresh_token) }); }
  catch (error) { return res.status(503).json({ error: error.message }); }
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

app.post('/api/streamer/location', async (req, res) => {
  const identity = await getStreamerIdentity(req);
  if (!identity) return res.status(401).json({ error: 'Sign in to save your private location.' });
  const validated = validateSosPayload({ streamer_id: identity.id, location: req.body?.location, module_type: 'FULE_PROTECT', source: 'button' });
  if (!validated.ok) return res.status(400).json({ error: validated.error });
  await saveStreamerLocation(identity.id, validated.value.location);
  while (streamerLocations.size > 2_000) streamerLocations.delete(streamerLocations.keys().next().value);
  return res.json({ ok: true });
});

function locationInput(value) {
  return value && Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90 && Number.isFinite(value.lng) && value.lng >= -180 && value.lng <= 180;
}

async function runRetentionCleanup() {
  const retentionDays = Number(process.env.INCIDENT_RETENTION_DAYS) || 90;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  if (typeof incidentRepository.expiredEvidenceKeys === 'function') {
    const keys = await incidentRepository.expiredEvidenceKeys(cutoff);
    await evidenceVault.removeStorageKeys(keys);
  }
  await cleanupIncidentData(retentionDays);
  const deletedRecordings = await liveStreamService.pruneRecordings({ maxAgeDays: Number(process.env.LIVEKIT_RECORDING_RETENTION_DAYS) || 30 });
  for (const recording of deletedRecordings) writeAudit({ event: 'LIVEKIT_RECORDING_EXPIRED', incident_id: recording.incident_id, actor_id: 'retention-worker', details: `evidence_sequence=${recording.evidence_sequence}` });
}

async function authorizeSafeWalk(req, walkId) {
  const record = await safetyFeatureStore.get(walkId);
  const token = String(req.get('X-Safe-Walk-Token') || '');
  return record && safeWalkTokenMatches(token, record.session_token_hash) ? record : null;
}

app.post('/api/safe-walks', requestLimit({ limit: 5, windowMs: 60_000 }), async (req, res) => {
  const identity = await getStreamerIdentity(req, req.body?.streamer_id);
  if (!identity) return res.status(401).json({ error: 'Sign in with a FULE account before starting a safe walk.' });
  const { destination, eta_minutes: etaMinutes, check_in_interval_minutes: interval, safe_pin: safePin, duress_pin: duressPin, location } = req.body || {};
  if (typeof destination !== 'string' || destination.trim().length < 2 || destination.length > 160) return res.status(400).json({ error: 'Enter a destination between 2 and 160 characters.' });
  if (!Number.isInteger(etaMinutes) || etaMinutes < 1 || etaMinutes > 720 || !Number.isInteger(interval) || interval < 1 || interval > 60) return res.status(400).json({ error: 'ETA must be 1–720 minutes and check-in interval 1–60 minutes.' });
  if (![safePin, duressPin].every((pin) => typeof pin === 'string' && /^\d{4,8}$/.test(pin)) || safePin === duressPin) return res.status(400).json({ error: 'Set distinct 4–8 digit safe and duress PINs.' });
  if (location && !locationInput(location)) return res.status(400).json({ error: 'Location coordinates are invalid.' });
  if (!location && !demoMode) return res.status(400).json({ error: 'Current location is required to start a safe walk.' });
  try {
    const result = await safeWalkWorkflow.start({ streamer_id: identity.id, destination, eta_minutes: etaMinutes, check_in_interval_minutes: interval, safe_pin: safePin, duress_pin: duressPin, location: location ? { lat: location.lat, lng: location.lng } : null });
    writeAudit({ event: 'SAFE_WALK_STARTED', actor_id: identity.id, details: result.walk.walk_id });
    return res.status(201).json(result);
  } catch (error) { return res.status(503).json({ error: `Could not start safe walk: ${error.message}` }); }
});

app.get('/api/safe-walks/push-key', (_req, res) => res.json({ public_key: getWebPushPublicKey() }));

function validPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const endpoint = new URL(value);
    const host = endpoint.hostname.toLowerCase();
    const allowed = host === 'fcm.googleapis.com'
      || host === 'updates.push.services.mozilla.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.notify.windows.com');
    return endpoint.protocol === 'https:' && endpoint.port === '' && !endpoint.username && !endpoint.password && allowed;
  } catch { return false; }
}

app.post('/api/safe-walks/push-subscription', async (req, res) => {
  const identity = await getStreamerIdentity(req, req.body?.streamer_id);
  if (!identity) return res.status(401).json({ error: 'Sign in with a FULE account before enabling notifications.' });
  const subscription = req.body?.subscription;
  if (!subscription || !validPushEndpoint(subscription.endpoint)
    || typeof subscription.keys?.p256dh !== 'string' || subscription.keys.p256dh.length > 256
    || typeof subscription.keys?.auth !== 'string' || subscription.keys.auth.length > 128) return res.status(400).json({ error: 'A valid Web Push subscription is required.' });
  await safetyFeatureStore.savePushSubscription(identity.id, { endpoint: subscription.endpoint, expirationTime: subscription.expirationTime || null, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
  writeAudit({ event: 'SAFE_WALK_PUSH_SUBSCRIPTION_SAVED', actor_id: identity.id });
  return res.status(201).json({ ok: true });
});

app.delete('/api/safe-walks/push-subscription', async (req, res) => {
  const identity = await getStreamerIdentity(req, req.body?.streamer_id);
  if (!identity) return res.status(401).json({ error: 'Sign in with a FULE account before managing notifications.' });
  if (!validPushEndpoint(req.body?.endpoint)) return res.status(400).json({ error: 'A valid Web Push endpoint is required.' });
  await safetyFeatureStore.removePushSubscription(identity.id, req.body.endpoint);
  return res.json({ ok: true });
});

app.get('/api/safe-walks/:walkId', async (req, res) => {
  const record = await authorizeSafeWalk(req, String(req.params.walkId));
  if (!record) return res.status(403).json({ error: 'Safe-walk session is invalid.' });
  return res.json({ walk: record.walk });
});

app.post('/api/safe-walks/:walkId/location', async (req, res) => {
  const record = await authorizeSafeWalk(req, String(req.params.walkId));
  if (!record) return res.status(403).json({ error: 'Safe-walk session is invalid.' });
  if (!locationInput(req.body?.location)) return res.status(400).json({ error: 'Location coordinates are invalid.' });
  const walk = await safeWalkWorkflow.addLocation(record.walk.walk_id, req.body.location);
  return walk ? res.json({ ok: true }) : res.status(409).json({ error: 'Safe walk is no longer active.' });
});

app.post('/api/safe-walks/:walkId/check-in', async (req, res) => {
  const record = await authorizeSafeWalk(req, String(req.params.walkId));
  if (!record) return res.status(403).json({ error: 'Safe-walk session is invalid.' });
  if (req.body?.location && !locationInput(req.body.location)) return res.status(400).json({ error: 'Location coordinates are invalid.' });
  const result = await safeWalkWorkflow.checkin(record.walk.walk_id, req.get('X-Safe-Walk-Token'), String(req.body?.pin || ''), req.body?.location);
  if (!result.ok) return res.status(400).json({ error: 'PIN is invalid or check-in is no longer active.' });
  if (result.duress) writeAudit({ event: 'SAFE_WALK_DURESS_ESCALATION', actor_id: record.walk.streamer_id, incident_id: result.incident?.incident_id || null });
  else writeAudit({ event: 'SAFE_WALK_CHECKED_IN', actor_id: record.walk.streamer_id, details: record.walk.walk_id });
  return res.json({ ok: true, status: result.status, walk: result.walk });
});

app.post('/api/safe-walks/:walkId/cancel', async (req, res) => {
  const record = await authorizeSafeWalk(req, String(req.params.walkId));
  if (!record) return res.status(403).json({ error: 'Safe-walk session is invalid.' });
  const cancelled = await safeWalkWorkflow.cancel(record.walk.walk_id, req.get('X-Safe-Walk-Token'));
  if (!cancelled) return res.status(409).json({ error: 'Safe walk is already closed.' });
  writeAudit({ event: 'SAFE_WALK_CANCELLED', actor_id: record.walk.streamer_id, details: record.walk.walk_id });
  return res.json({ ok: true, status: 'CANCELLED' });
});

app.post('/api/guardians/duty', async (req, res) => {
  const guardian = getGuardian(req);
  if (!guardian) return res.status(403).json({ error: 'Verified guardian access required.' });
  const onDuty = req.body?.on_duty === true;
  if (!onDuty) {
    await safetyFeatureStore.removeDutyLocation(guardian.guardian_id);
    writeAudit({ event: 'GUARDIAN_OFF_DUTY', actor_id: guardian.guardian_id });
    return res.json({ on_duty: false });
  }
  if (!locationInput(req.body?.location)) return res.status(400).json({ error: 'Location coordinates are invalid.' });
  const area = typeof req.body?.area_label === 'string' ? req.body.area_label.trim().slice(0, 120) : '';
  const areaLabel = area || `Neighborhood near ${req.body.location.lat.toFixed(2)}, ${req.body.location.lng.toFixed(2)}`;
  await safetyFeatureStore.saveDutyLocation(guardian.guardian_id, { lat: req.body.location.lat, lng: req.body.location.lng, area_label: areaLabel });
  writeAudit({ event: 'GUARDIAN_ON_DUTY', actor_id: guardian.guardian_id, details: 'Guardian enabled coarse-area proximity matching.' });
  return res.json({ on_duty: true, area_label: areaLabel });
});

app.get('/api/guardians/duty', async (req, res) => {
  const guardian = getGuardian(req);
  if (!guardian) return res.status(403).json({ error: 'Verified guardian access required.' });
  const location = await safetyFeatureStore.getDutyLocation(guardian.guardian_id);
  return res.json({ on_duty: Boolean(location), area_label: location?.area_label || null, updated_at: location?.updated_at || null });
});

app.post('/api/incidents/:incidentId/nearby-accept', async (req, res) => {
  const guardian = getGuardian(req);
  if (!guardian) return res.status(403).json({ error: 'Verified guardian access required.' });
  const incident = await getIncident(String(req.params.incidentId));
  if (!incident || !['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(incident.status)) return res.status(404).json({ error: 'Active incident not found.' });
  const maxAccepted = Math.max(1, Math.min(20, Number(process.env.NEARBY_GUARDIAN_ACCEPT_CAP) || 5));
  const accepted = await safetyFeatureStore.acceptNearbyGuardian(incident.incident_id, guardian.guardian_id, maxAccepted);
  if (!accepted.accepted) return res.status(409).json({ error: 'This responder is not eligible or the incident has reached its responder limit.', accepted_count: accepted.count });
  writeAudit({ event: 'NEARBY_GUARDIAN_ACCEPTED', incident_id: incident.incident_id, actor_id: guardian.guardian_id });
  const update = { incident_id: incident.incident_id, accepted_count: accepted.count, cap: maxAccepted };
  io.to(`streamer:${incident.incident_id}`).emit('nearby_guardians_update', update);
  io.to('guardians').emit('nearby_guardians_update', update);
  return res.json({ accepted: true, accepted_count: accepted.count, incident });
});

app.post('/api/incidents/:incidentId/stream-token', requestLimit({ limit: 20, windowMs: 60_000 }), async (req, res) => {
  const incident = await getIncident(String(req.params.incidentId));
  if (!incident) return res.status(404).json({ error: 'Incident not found.' });
  const guardian = getGuardian(req);
  const trustedContact = authenticateTrustedContactStreamToken(getBearerToken(req), incident.incident_id, incident.streamer_id);
  let role; let principal; let authorized = false;
  if (guardian) {
    const accepted = await safetyFeatureStore.guardianHasAcceptedOffer(incident.incident_id, guardian.guardian_id);
    authorized = accepted || incident.acknowledged_by === guardian.guardian_id;
    role = 'guardian'; principal = { id: guardian.guardian_id, name: guardian.display_name || 'Verified guardian' };
  } else if (trustedContact) {
    authorized = true; role = 'trusted_contact'; principal = trustedContact;
  } else {
    const identity = await getStreamerIdentity(req, req.body?.streamer_id);
    const credentials = await loadCancelCredential(incident.incident_id);
    const evidenceToken = req.get('X-Streamer-Evidence-Token');
    authorized = Boolean(identity && credentials && identity.id === incident.streamer_id && credentials.streamer_id === identity.id && tokenMatches(evidenceToken, credentials.token_hash));
    role = 'streamer'; principal = identity && { id: identity.id, name: identity.user?.display_name || 'Streamer' };
  }
  try {
    const token = await liveStreamService.issueToken({ incident, principal, role, authorized });
    writeAudit({ event: 'LIVEKIT_TOKEN_ISSUED', incident_id: incident.incident_id, actor_id: principal?.id || null, details: `role=${role}; expires=${token.expires_at}` });
    return res.json(token);
  } catch (error) { return res.status(error.status || 503).json({ error: error.message || 'Live stream is unavailable.' }); }
});

app.post('/api/livekit/webhook', async (req, res) => {
  if (!req.rawBody) return res.status(400).json({ error: 'Signed LiveKit webhook body is required.' });
  try {
    const result = await liveStreamService.handleWebhook(req.rawBody, req.get('Authorization'));
    if (result.handled) {
      writeAudit({ event: 'LIVEKIT_RECORDING_HASHED', incident_id: result.incident_id, actor_id: 'livekit-egress', details: `sequence=${result.evidence.sequence}; sha256=${result.evidence.sha256}; chain_hash=${result.evidence.chain_hash}` });
      io.to('guardians').emit('incident_evidence_added', { incident_id: result.incident_id, sequence: result.evidence.sequence, sha256: result.evidence.sha256, source: 'livekit_egress' });
    }
    return res.json({ received: true, handled: result.handled });
  } catch (error) { log('error', 'livekit_webhook_rejected', { taxonomy: 'dependency', error: error.message }); return res.status(401).json({ error: 'LiveKit webhook verification or recording handling failed.' }); }
});

app.get('/api/incidents', requestLimit({ limit: 60, windowMs: 60_000 }), requireRoles('guardian', 'admin'), async (req, res) => {
  const guardian = req.guardianIdentity;
  const limit = req.query?.limit === undefined ? 100 : Number(req.query.limit);
  const offset = req.query?.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return res.status(400).json({ error: 'limit must be 1–100 and offset a non-negative integer.' });
  const page = await listIncidentPage({ limit, offset });
  const visible = await Promise.all(page.map(async ({ streamer_id, ...incident }) => await safetyFeatureStore.guardianHasPendingOffer(incident.incident_id, guardian.guardian_id) ? toPublicIncident(incident) : incident));
  return res.json({ incidents: visible, guardian_id: guardian.guardian_id, limit, offset });
});

app.post('/api/incidents/:incidentId/acknowledge', requestLimit({ limit: 20, windowMs: 60_000 }), requireRoles('guardian', 'admin'), async (req, res) => {
  const guardian = req.guardianIdentity;
  const result = await acknowledgeIncident(String(req.params.incidentId), guardian.guardian_id);
  return result.ok ? res.json({ incident: result.incident }) : res.status(result.status).json({ error: result.error });
});

app.get('/api/incidents/:incidentId/case-file', async (req, res) => {
  const guardian = getGuardian(req);
  if (!guardian && !mayAccessDispatch(req)) return res.status(403).json({ error: 'Verified guardian or dispatch authority required.' });
  const incident = await getIncident(String(req.params.incidentId));
  if (!incident) return res.status(404).json({ error: 'Incident not found.' });
  if (guardian && await safetyFeatureStore.guardianHasPendingOffer(incident.incident_id, guardian.guardian_id)) return res.status(403).json({ error: 'Accept the nearby response request before accessing exact details.' });
  const walks = await safetyFeatureStore.walksForIncident(incident.incident_id);
  const bundle = await evidenceVault.createCaseFile(incident, { walks });
  res.setHeader('Content-Disposition', `attachment; filename="FULE-${incident.incident_id}-case-file.json"`);
  return res.json(bundle);
});

app.post('/api/incidents/:incidentId/evidence', express.raw({ type: ['audio/*', 'video/*'], limit: '5mb' }), async (req, res) => {
  const incidentId = String(req.params.incidentId);
  const incident = await getIncident(incidentId);
  const credentials = await loadCancelCredential(incidentId);
  if (!incident || !credentials || !tokenMatches(req.get('X-Streamer-Evidence-Token'), credentials.token_hash) || credentials.streamer_id !== incident.streamer_id) return res.status(403).json({ error: 'Evidence upload requires the active streamer session.' });
  if (!['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status)) return res.status(409).json({ error: 'Evidence upload is closed for this incident.' });
  const contentType = req.get('Content-Type')?.split(';')[0].toLowerCase();
  try {
    const entry = await evidenceVault.appendChunk(incidentId, req.body, { contentType });
    writeAudit({ event: 'EVIDENCE_CHUNK_STORED', incident_id: incidentId, actor_id: credentials.streamer_id, details: `sequence=${entry.sequence} sha256=${entry.sha256}` });
    io.to('guardians').emit('incident_evidence_added', { incident_id: incidentId, sequence: entry.sequence, recorded_at: entry.recorded_at, sha256: entry.sha256 });
    return res.status(201).json({ evidence: { chunk_id: entry.chunk_id, sequence: entry.sequence, recorded_at: entry.recorded_at, sha256: entry.sha256, chain_hash: entry.chain_hash } });
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

app.get('/api/incidents/:incidentId/evidence/:chunkId', async (req, res) => {
  if (!getGuardian(req) && !mayAccessDispatch(req)) return res.status(403).json({ error: 'Verified guardian or dispatch authority required.' });
  const incidentId = String(req.params.incidentId);
  const entries = await safetyFeatureStore.listEvidence(incidentId);
  const entry = entries.find((item) => item.chunk_id === req.params.chunkId);
  if (!entry) return res.status(404).json({ error: 'Evidence chunk not found.' });
  if (entries.some((item) => item.metadata?.source === 'retention_tombstone' && item.metadata.target_chunk_id === entry.chunk_id)) return res.status(410).json({ error: 'Recording expired under the evidence retention policy; its hash remains in the audit chain.' });
  const bytes = await evidenceVault.readChunk(entry);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return res.status(409).json({ error: 'Evidence integrity verification failed.' });
  res.type(entry.metadata?.content_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.chunk_id}.webm"`);
  return res.send(bytes);
});

app.get('/api/streamer/trusted-contacts', requestLimit({ limit: 30, windowMs: 60_000 }), async (req, res) => {
  const identity = await getStreamerIdentity(req, req.query?.streamer_id);
  if (!identity) return res.status(401).json({ error: 'Sign in with a FULE account to manage your trusted circle.' });
  return res.json({ contacts: await loadTrustedContactsFresh(identity.id) });
});

app.put('/api/streamer/trusted-contacts', requestLimit({ limit: 10, windowMs: 60_000 }), async (req, res) => {
  const identity = await getStreamerIdentity(req, req.body?.streamer_id);
  if (!identity) return res.status(401).json({ error: 'Sign in with a FULE account to manage your trusted circle.' });
  const contacts = req.body?.contacts;
  if (!Array.isArray(contacts) || contacts.length > 3) return res.status(400).json({ error: 'Add no more than three trusted contacts.' });
  const normalized = [];
  for (const contact of contacts) {
    const name = typeof contact?.name === 'string' ? contact.name.trim().slice(0, 80) : '';
    const email = typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '';
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) return res.status(400).json({ error: 'Each trusted circle member needs a name and FULE account email.' });
    normalized.push({ name, email });
  }
  await saveTrustedContacts(identity.id, normalized);
  await flushIncidentWrites();
  writeAudit({ event: 'TRUSTED_CONTACTS_UPDATED', actor_id: identity.id, details: `${normalized.length} trusted contact(s) saved.` });
  return res.json({ contacts: normalized });
});

function mayAccessDispatch(req) { return Boolean(getGuardian(req) || (demoMode && isLoopbackRequest(req))); }

app.get('/api/dispatch/queue', requestLimit({ limit: 60, windowMs: 60_000 }), async (req, res) => {
  if (!mayAccessDispatch(req)) return res.status(403).json({ error: 'Verified guardian or local demo access required.' });
  const guardian = getGuardian(req);
  const queue = await Promise.all((await listDispatchQueue({ limit: 100 })).map(async ({ streamer_id, ...incident }) => guardian && await safetyFeatureStore.guardianHasPendingOffer(incident.incident_id, guardian.guardian_id) ? toPublicIncident(incident) : incident));
  return res.json({ simulated: demoMode, incidents: queue });
});

app.post('/api/dispatch/:incidentId/action', requestLimit({ limit: 60, windowMs: 60_000 }), async (req, res) => {
  if (!mayAccessDispatch(req)) return res.status(403).json({ error: 'Verified guardian or local demo access required.' });
  const incidentId = String(req.params.incidentId || '');
  const guardian = getGuardian(req);
  if (guardian && await safetyFeatureStore.guardianHasPendingOffer(incidentId, guardian.guardian_id)) return res.status(403).json({ error: 'Accept the nearby response request before accessing exact details.' });
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
  const account = authenticateAccess(getBearerToken(req));
  const loadTestAuthorized = demoMode && Boolean(loadTestTokenHash) && tokenMatches(req.get('x-fule-load-test-token'), loadTestTokenHash);
  const authenticatedStreamer = account && ['user', 'guardian', 'admin'].includes(account.role) && req.body?.streamer_id === account.account_id;
  if (!authenticatedStreamer && !loadTestAuthorized && !(demoMode && isLoopbackRequest(req))) return res.status(401).json({ error: 'Sign in with the matching FULE account to trigger SOS.' });
  const source = req.body?.source || 'button';
  if (!['button', 'shake', 'keyboard'].includes(source)) return res.status(400).json({ error: 'SOS source must be button, shake, or keyboard.' });
  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required for SOS requests.' });
  if (!/^[\w:.-]{8,180}$/.test(idempotencyKey)) return res.status(400).json({ error: 'Idempotency-Key must contain 8–180 safe characters.' });
  try {
    const scopedKey = `${req.body?.streamer_id}:${createHash('sha256').update(idempotencyKey).digest('hex')}`;
    if (incidentRepository.db) {
      const windowStart = new Date(Date.now() - 24 * 60 * 60_000);
      const existing = await incidentRepository.db('idempotency_keys').where({ key: scopedKey }).where('created_at', '>', windowStart).first();
      if (existing?.response) return res.status(200).json(existing.response);
      if (existing) {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const pending = await incidentRepository.db('idempotency_keys').where({ key: scopedKey }).first();
          if (pending?.response) return res.status(200).json(pending.response);
        }
        res.set('Retry-After', '1');
        return res.status(503).json({ error: 'A request with this idempotency key is still being processed. Retry with the same key.' });
      }
      await incidentRepository.db('idempotency_keys').where({ key: scopedKey }).del();
      const inserted = await incidentRepository.db('idempotency_keys').insert({ key: scopedKey, streamer_id: req.body?.streamer_id, incident_id: `pending:${randomBytes(8).toString('hex')}`, response: null, created_at: new Date() }).onConflict('key').ignore().returning('key');
      if (!inserted.length) {
        res.set('Retry-After', '1');
        return res.status(503).json({ error: 'A request with this idempotency key is already being processed. Retry with the same key.' });
      }
    }
    if (scopedKey && memoryIdempotency.has(scopedKey)) {
      const cached = memoryIdempotency.get(scopedKey);
      if (cached.expires_at > Date.now()) return res.status(200).json(cached.response);
      memoryIdempotency.delete(scopedKey);
    }
    if (scopedKey && creatingIdempotency.has(scopedKey)) {
      const replay = await creatingIdempotency.get(scopedKey);
      return res.status(200).json(replay);
    }
    const work = createSosIncident(req.body);
    if (scopedKey) creatingIdempotency.set(scopedKey, work.then((result) => result.body));
    const result = await work;
    if (result.status === 201 && scopedKey) {
      memoryIdempotency.set(scopedKey, { response: result.body, expires_at: Date.now() + 24 * 60 * 60_000 });
      if (incidentRepository.db) await incidentRepository.db('idempotency_keys').where({ key: scopedKey }).update({ incident_id: result.body.incident.incident_id, response: JSON.stringify(result.body) });
    } else if (scopedKey && incidentRepository.db) {
      await incidentRepository.db('idempotency_keys').where({ key: scopedKey }).del();
    }
    await flushIncidentWrites();
    return res.status(result.status).json(result.body);
  }
  catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An active incident already exists for this streamer.' });
    log('error', 'sos_create_failed', { request_id: req.id, error: error.message });
    return res.status(500).json({ error: 'Could not create incident. Please retry.' });
  } finally { if (req.get('Idempotency-Key')) creatingIdempotency.delete(`${req.body?.streamer_id}:${createHash('sha256').update(String(req.get('Idempotency-Key'))).digest('hex')}`); }
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
    socket.join(`guardian:${socket.data.guardianId}`);
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

  socket.on('register_safe_walk', async ({ walk_id, session_token } = {}) => {
    if (socket.data.safeWalkId || typeof walk_id !== 'string' || typeof session_token !== 'string') return;
    const record = await safetyFeatureStore.get(walk_id);
    if (!record || !safeWalkTokenMatches(session_token, record.session_token_hash) || !['ACTIVE', 'AWAITING_CHECKIN'].includes(record.walk.status)) {
      socket.emit('safe_walk_registration_failed', { walk_id });
      return;
    }
    socket.data.safeWalkId = walk_id;
    socket.join(`safe-walk:${walk_id}`);
    socket.emit('safe_walk_registered', { walk_id });
  });

  socket.on('acknowledge_incident', async (incidentId) => {
    if (socket.data.role !== 'guardian' || !socket.data.guardianId) return;
    if (typeof incidentId !== 'string' || incidentId.length > 128) return;
    try {
      const result = await acknowledgeIncident(String(incidentId), socket.data.guardianId);
      if (!result.ok) socket.emit(result.status === 403 ? 'guardian_accept_required' : 'acknowledgement_rejected', { incident_id: incidentId, reason: result.error });
    } catch (error) { log('error', 'incident_acknowledgement_failed', { incident_id: incidentId, error: error.message }); }
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

// Errors are logged locally; deployment can collect stdout with a self-hosted stack.

await startBackgroundWorkers({
  onContact: contactTrustedPeople,
  onDispatch: (incidentId) => sendToDispatch(incidentId, 'T_PLUS_60'),
  onCleanup: runRetentionCleanup,
  onSafeWalkCheckin: async (walkId, checkinNumber) => {
    const due = await safeWalkWorkflow.checkinDue(walkId, checkinNumber);
    if (due) writeAudit({ event: 'SAFE_WALK_CHECKIN_DUE', details: `${walkId}:${checkinNumber}` });
  },
  onSafeWalkTimeout: async (walkId, checkinNumber) => {
    const incident = await safeWalkWorkflow.timeout(walkId, checkinNumber);
    if (incident) writeAudit({ event: 'SAFE_WALK_AUTO_SOS', incident_id: incident.incident?.incident_id || null, details: `${walkId}:${checkinNumber}` });
  }
});
const streamRetentionTimer = setInterval(() => { void runRetentionCleanup().catch((error) => log('error', 'retention_cleanup_failed', { taxonomy: 'dependency', error: error.message })); }, 60 * 60 * 1000);
streamRetentionTimer.unref?.();
void runRetentionCleanup().catch((error) => log('error', 'retention_cleanup_failed', { taxonomy: 'dependency', error: error.message }));
await verifyRuntimeInfrastructure();

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
  log('error', 'request_middleware_error', { request_id: _req.id, error: error.message, taxonomy: error.type ? 'client' : 'internal' });
  return res.status(500).json({ error: 'Request could not be processed.' });
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'graceful_shutdown_started', { signal });
  clearInterval(streamRetentionTimer);
  for (const incidentId of timers.keys()) clearIncidentTimers(incidentId);
  await flushIncidentWrites();
  await new Promise((resolve) => io.close(resolve));
  await Promise.allSettled([closeRuntimeInfrastructure(), closeIncidentStore()]);
  process.exit(0);
}
process.once('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.once('SIGINT', () => { void gracefulShutdown('SIGINT'); });

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
import { synthesizeIncident } from './services/incidentSynthesizer.js';
import { createStreamerRateLimiter, validateSosPayload } from './services/sosValidation.js';

dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)) });

const app = express();
const httpServer = http.createServer(app);
const port = Number(process.env.PORT) || 4000;
const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const demoMode = process.env.DEMO_MODE !== 'false';
if (demoMode) seedDemoInvite(process.env.FULE_DEMO_GUARDIAN_INVITE);

const io = new Server(httpServer, { cors: { origin: allowedOrigin, methods: ['GET', 'POST'] } });
const rateLimitSos = createStreamerRateLimiter({ limit: 3, windowMs: 5 * 60 * 1000 });
const incidents = new Map();
const cancelCredentials = new Map();
const timers = new Map();
const inviteAttempts = new Map();

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '1mb' }));

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
  return updated;
}

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
  return true;
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.guardianToken;
  const guardian = authenticateGuardian(token);
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
  res.json({ status: 'ok', service: 'FULE Protect API', demoMode, openaiEnabled: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/guardians/verify', (req, res) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  if (!consumeInviteAttempt(key)) return res.status(429).json({ error: 'Too many invite attempts. Try again in one minute.' });
  const verified = verifyGuardianInvite(req.body?.invite_code, { allowDemo: demoMode });
  if (!verified) return res.status(401).json({ error: 'Invalid or inactive guardian invite.' });
  return res.json(verified);
});

app.get('/api/incidents', (req, res) => {
  const guardian = getGuardian(req);
  if (!guardian) return res.status(403).json({ error: 'Verified guardian access required.' });
  return res.json({ incidents: [...incidents.values()], guardian_id: guardian.guardian_id });
});

app.post('/api/sos', async (req, res) => {
  const validated = validateSosPayload(req.body);
  if (!validated.ok) return res.status(400).json({ error: validated.error });
  const payload = validated.value;
  const limit = rateLimitSos(payload.streamer_id);
  if (!limit.allowed) {
    res.set('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'SOS rate limit reached. Maximum 3 activations per streamer every 5 minutes.' });
  }

  try {
    const activatedAt = Date.now();
    const dispatchReadyAt = activatedAt + 10_000;
    const escalationAt = activatedAt + 30_000;
    const synthesis = await synthesizeIncident({
      audio_transcript_snippet: payload.audio_transcript_snippet,
      module_type: payload.module_type,
      location: payload.location
    });
    const createdAt = new Date(activatedAt);
    const incident = createIncident({
      incident_id: `sos-${createdAt.getTime()}-${randomBytes(4).toString('hex')}`,
      threat_level: synthesis.threat_level,
      module: payload.module_type,
      location: payload.location,
      summary: synthesis.summary,
      recommended_action: synthesis.recommended_action,
      status: 'PENDING_DISPATCH',
      created_at: createdAt.toISOString(),
      acknowledged_by: null,
      clip_url: null,
      source: payload.source,
      escalated: false,
      escalation_flag: null
    });
    if (!isIncident(incident)) return res.status(500).json({ error: 'Incident failed schema validation.' });

    const cancelToken = randomBytes(32).toString('base64url');
    writeStateChange({ incident, event: 'SOS_CREATED', fromStatus: null, toStatus: incident.status, actorId: payload.streamer_id });
    incidents.set(incident.incident_id, incident);
    cancelCredentials.set(incident.incident_id, {
      streamer_id: payload.streamer_id,
      token_hash: hashToken(cancelToken).toString('hex'),
      dispatch_ready_at: dispatchReadyAt
    });
    const graceDelayMs = Math.max(0, dispatchReadyAt - Date.now());
    const escalationDelayMs = Math.max(0, escalationAt - Date.now());
    io.to('guardians').emit('sos_activated', { ...incident, grace_period_seconds: Math.ceil(graceDelayMs / 1000) });
    io.to('public').emit('incident:public', toPublicIncident(incident));
    scheduleDispatch(incident, { graceDelayMs, escalationDelayMs });
    return res.status(201).json({ incident, streamer_cancel_token: cancelToken });
  } catch (error) {
    console.error('Could not create SOS incident:', error.message);
    return res.status(500).json({ error: 'Could not create incident. Please retry.' });
  }
});

io.on('connection', (socket) => {
  if (socket.data.role === 'guardian') {
    socket.join('guardians');
    const expirationTimer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.guardianExpiresAt - Date.now()));
    expirationTimer.unref?.();
    socket.on('disconnect', () => clearTimeout(expirationTimer));
  } else socket.join('public');
  socket.emit('fule:access', { role: socket.data.role, guardian_id: socket.data.guardianId || null });

  socket.on('register_streamer', ({ incident_id, streamer_id, cancel_token } = {}) => {
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

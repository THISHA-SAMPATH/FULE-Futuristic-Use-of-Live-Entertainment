export const INCIDENT_MODULES = Object.freeze(['FULE_PROTECT', 'FULE_ACCOUNT', 'FULE_RESPOND']);
export const INCIDENT_MODULE = 'FULE_PROTECT';
export const INCIDENT_SOURCES = Object.freeze(['button', 'chat', 'redeem']);
export const THREAT_LEVELS = Object.freeze(['LOW', 'ELEVATED', 'HIGH', 'CRITICAL']);
export const INCIDENT_STATUSES = Object.freeze([
  'PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'CANCELLED', 'FALSE_ALARM', 'ESCALATED', 'RESOLVED'
]);
export const DISPATCH_STATUSES = Object.freeze(['QUEUED', 'SENT', 'ACKNOWLEDGED', 'FAILED']);
export const DISPATCH_STAGES = Object.freeze(['ALERTED', 'GUARDIANS', 'CONTACTS', 'POLICE_DISPATCHED', 'EN_ROUTE', 'RESOLVED', 'STAND_DOWN', 'FAILED']);

export const INCIDENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'incident_id', 'threat_level', 'module', 'location', 'summary',
    'recommended_action', 'status', 'created_at', 'acknowledged_by', 'clip_url', 'stream_url', 'source', 'escalated', 'escalation_flag',
    'transcript_snippet', 'streamer_contact', 'guardian_responses', 'acknowledged_at', 'contacts_notified_at', 'dispatch_record', 'dispatch_stage', 'repeat_offender'
  ],
  properties: {
    incident_id: { type: 'string' },
    threat_level: { type: 'string', enum: [...THREAT_LEVELS] },
    module: { type: 'string', enum: [...INCIDENT_MODULES] },
    location: {
      type: 'object', additionalProperties: false,
      required: ['lat', 'lng', 'address'],
      properties: {
        lat: { type: ['number', 'null'], minimum: -90, maximum: 90 },
        lng: { type: ['number', 'null'], minimum: -180, maximum: 180 },
        address: { type: 'string' }
      }
    },
    summary: { type: 'string' },
    recommended_action: { type: 'string' },
    status: { type: 'string', enum: [...INCIDENT_STATUSES] },
    created_at: { type: 'string' },
    acknowledged_by: { type: ['string', 'null'] },
    clip_url: { type: ['string', 'null'] },
    stream_url: { type: ['string', 'null'] },
    source: { type: 'string', enum: [...INCIDENT_SOURCES] },
    escalated: { type: 'boolean' },
    escalation_flag: { type: ['string', 'null'] },
    transcript_snippet: { type: 'string' },
    streamer_contact: { type: ['object', 'null'] },
    guardian_responses: { type: 'array' },
    acknowledged_at: { type: ['string', 'null'] },
    contacts_notified_at: { type: ['string', 'null'] },
    dispatch_record: { type: ['object', 'null'] },
    dispatch_stage: { type: 'string', enum: [...DISPATCH_STAGES] },
    repeat_offender: { type: 'boolean' }
  }
});

export function createIncident({
  incident_id,
  threat_level = 'CRITICAL',
  module = INCIDENT_MODULE,
  location,
  summary,
  recommended_action = 'DISPATCH_COMMUNITY_MODS',
  status = 'ACTIVE',
  created_at = new Date().toISOString(),
  acknowledged_by = null,
  clip_url = null,
  stream_url = null,
  source = 'button',
  escalated = false,
  escalation_flag = null,
  transcript_snippet = '',
  streamer_contact = null,
  guardian_responses = [],
  acknowledged_at = null,
  contacts_notified_at = null,
  dispatch_record = null,
  dispatch_stage = 'ALERTED',
  repeat_offender = false
}) {
  const lat = location?.lat == null ? null : Number(location.lat);
  const lng = location?.lng == null ? null : Number(location.lng);
  const safeThreat = THREAT_LEVELS.includes(threat_level) ? threat_level : 'CRITICAL';
  const safeSource = INCIDENT_SOURCES.includes(source) ? source : 'button';
  const safeStatus = INCIDENT_STATUSES.includes(status) ? status : 'PENDING_DISPATCH';
  const safeModule = INCIDENT_MODULES.includes(module) ? module : INCIDENT_MODULE;
  return {
    incident_id: String(incident_id || `incident-${Date.now()}`),
    threat_level: safeThreat,
    module: safeModule,
    location: {
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      address: String(location?.address || (lat == null || lng == null ? 'Location unavailable' : 'Simulated location · address withheld publicly')).slice(0, 160)
    },
    summary: String(summary || 'SOS received. Verify safety and location with the person.').slice(0, 800),
    recommended_action: String(recommended_action || 'DISPATCH_COMMUNITY_MODS').slice(0, 120),
    status: safeStatus,
    created_at: created_at || new Date().toISOString(),
    acknowledged_by: acknowledged_by == null ? null : String(acknowledged_by).slice(0, 120),
    clip_url: typeof clip_url === 'string' && clip_url ? clip_url.slice(0, 1000) : null,
    stream_url: typeof stream_url === 'string' && stream_url ? stream_url.slice(0, 1000) : null,
    source: safeSource,
    escalated: Boolean(escalated),
    escalation_flag: escalation_flag == null ? null : String(escalation_flag).slice(0, 160),
    transcript_snippet: String(transcript_snippet || '').slice(0, 1000),
    streamer_contact: streamer_contact && typeof streamer_contact === 'object' ? {
      streamer_id: String(streamer_contact.streamer_id || '').slice(0, 128),
      display_name: String(streamer_contact.display_name || 'Streamer').slice(0, 120),
      twitch_login: String(streamer_contact.twitch_login || '').slice(0, 50)
    } : null,
    guardian_responses: Array.isArray(guardian_responses) ? guardian_responses.slice(0, 20).map((response) => ({ guardian_id: String(response.guardian_id || '').slice(0, 120), at: String(response.at || ''), action: String(response.action || '').slice(0, 40) })) : [],
    acknowledged_at: acknowledged_at == null ? null : String(acknowledged_at),
    contacts_notified_at: contacts_notified_at == null ? null : String(contacts_notified_at),
    dispatch_record: dispatch_record && typeof dispatch_record === 'object' && DISPATCH_STATUSES.includes(dispatch_record.status) ? {
      dispatch_id: String(dispatch_record.dispatch_id || '').slice(0, 128),
      status: dispatch_record.status,
      responder_eta_minutes: Number.isFinite(dispatch_record.responder_eta_minutes) ? dispatch_record.responder_eta_minutes : null,
      queued_at: String(dispatch_record.queued_at || ''),
      sent_at: dispatch_record.sent_at == null ? null : String(dispatch_record.sent_at),
      stage: String(dispatch_record.stage || '').slice(0, 40),
      simulated: Boolean(dispatch_record.simulated)
    } : null,
    dispatch_stage: DISPATCH_STAGES.includes(dispatch_stage) ? dispatch_stage : 'ALERTED',
    repeat_offender: Boolean(repeat_offender)
  };
}

// A deliberately coarse, non-identifying projection for public subscriptions.
export function toPublicIncident(incident) {
  return {
    ...incident,
    location: {
      lat: Number.isFinite(incident.location.lat) ? Math.round(incident.location.lat * 100) / 100 : null,
      lng: Number.isFinite(incident.location.lng) ? Math.round(incident.location.lng * 100) / 100 : null,
      address: 'Approximate area · precise location shared with guardians'
    },
    summary: 'Safety incident in progress. Precise location and live details are restricted to guardians.',
    recommended_action: 'Await guardian response',
    acknowledged_by: null,
    clip_url: null,
    stream_url: null,
    escalation_flag: incident.escalation_flag,
    transcript_snippet: '', streamer_contact: null, guardian_responses: [], acknowledged_at: null,
    dispatch_record: null, dispatch_stage: incident.dispatch_stage, repeat_offender: false
  };
}

export function isIncident(value) {
  if (!value || typeof value !== 'object') return false;
  if (!INCIDENT_SCHEMA.required.every((key) => Object.hasOwn(value, key))) return false;
  return typeof value.incident_id === 'string'
    && THREAT_LEVELS.includes(value.threat_level)
    && INCIDENT_MODULES.includes(value.module)
    && (value.location?.lat === null || (Number.isFinite(value.location?.lat) && value.location.lat >= -90 && value.location.lat <= 90))
    && (value.location?.lng === null || (Number.isFinite(value.location?.lng) && value.location.lng >= -180 && value.location.lng <= 180))
    && ((value.location?.lat === null && value.location?.lng === null) || (Number.isFinite(value.location?.lat) && Number.isFinite(value.location?.lng)))
    && typeof value.location.address === 'string'
    && typeof value.summary === 'string'
    && typeof value.recommended_action === 'string'
    && INCIDENT_STATUSES.includes(value.status)
    && typeof value.created_at === 'string'
    && (typeof value.acknowledged_by === 'string' || value.acknowledged_by === null)
    && (typeof value.clip_url === 'string' || value.clip_url === null)
    && (typeof value.stream_url === 'string' || value.stream_url === null)
    && INCIDENT_SOURCES.includes(value.source)
    && typeof value.escalated === 'boolean'
    && (typeof value.escalation_flag === 'string' || value.escalation_flag === null)
    && typeof value.transcript_snippet === 'string'
    && (value.streamer_contact === null || typeof value.streamer_contact === 'object')
    && Array.isArray(value.guardian_responses)
    && (typeof value.acknowledged_at === 'string' || value.acknowledged_at === null)
    && (typeof value.contacts_notified_at === 'string' || value.contacts_notified_at === null)
    && (value.dispatch_record === null || DISPATCH_STATUSES.includes(value.dispatch_record.status))
    && DISPATCH_STAGES.includes(value.dispatch_stage)
    && typeof value.repeat_offender === 'boolean';
}

import { INCIDENT_MODULES, INCIDENT_SOURCES } from '../../shared/incident.mjs';

export function validateSosPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON object is required.' };
  const allowedKeys = new Set(['streamer_id', 'location', 'module_type', 'audio_transcript_snippet', 'source', 'silent_public', 'risk_level']);
  const unknown = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknown) return { ok: false, error: `Unsupported SOS field: ${unknown}.` };
  if (!body.location || typeof body.location !== 'object' || Array.isArray(body.location)) return { ok: false, error: 'location must be an object.' };
  const unknownLocationKey = Object.keys(body.location).find((key) => !['lat', 'lng', 'address'].includes(key));
  if (unknownLocationKey) return { ok: false, error: `Unsupported location field: ${unknownLocationKey}.` };
  const streamer_id = typeof body.streamer_id === 'string' ? body.streamer_id.trim() : '';
  if (!streamer_id || streamer_id.length > 100 || !/^[\w-]+$/.test(streamer_id)) {
    return { ok: false, error: 'streamer_id is required and must contain only letters, numbers, underscores, or hyphens.' };
  }
  const unavailable = body.location?.lat == null && body.location?.lng == null && body.location?.address === 'Location unavailable';
  const lat = body.location?.lat == null ? null : Number(body.location.lat);
  const lng = body.location?.lng == null ? null : Number(body.location.lng);
  if (!unavailable && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180)) return { ok: false, error: 'location.lat and location.lng must be valid coordinates.' };
  if (!unavailable && (typeof body.location.lat !== 'number' || typeof body.location.lng !== 'number')) return { ok: false, error: 'location coordinates must be JSON numbers.' };
  if (body.location.address != null && (typeof body.location.address !== 'string' || body.location.address.length > 160)) return { ok: false, error: 'location.address must be text up to 160 characters.' };
  const module_type = String(body.module_type || 'FULE_PROTECT').toUpperCase();
  if (!INCIDENT_MODULES.includes(module_type)) return { ok: false, error: `module_type must be one of: ${INCIDENT_MODULES.join(', ')}.` };
  const source = body.source || 'button';
  if (!INCIDENT_SOURCES.includes(source)) return { ok: false, error: `source must be one of: ${INCIDENT_SOURCES.join(', ')}.` };
  if (body.audio_transcript_snippet != null && typeof body.audio_transcript_snippet !== 'string') {
    return { ok: false, error: 'audio_transcript_snippet must be a string.' };
  }
  if (typeof body.audio_transcript_snippet === 'string' && body.audio_transcript_snippet.length > 4000) return { ok: false, error: 'audio_transcript_snippet cannot exceed 4000 characters.' };
  if (body.silent_public != null && typeof body.silent_public !== 'boolean') return { ok: false, error: 'silent_public must be a boolean.' };
  const risk_level = body.risk_level || 'standard';
  if (!['standard', 'elevated', 'high'].includes(risk_level)) return { ok: false, error: 'risk_level must be standard, elevated, or high.' };
  return {
    ok: true,
    value: {
      streamer_id,
      location: { lat, lng, address: unavailable ? 'Location unavailable' : 'Simulated location · address withheld publicly' },
      module_type,
      audio_transcript_snippet: String(body.audio_transcript_snippet || ''),
      source,
      risk_level,
      ...(body.silent_public === true ? { silent_public: true } : {}),
    }
  };
}

export function createStreamerRateLimiter({ limit = 3, windowMs = 5 * 60 * 1000 } = {}) {
  const requestsByStreamer = new Map();
  return (streamerId, now = Date.now()) => {
    const active = (requestsByStreamer.get(streamerId) || []).filter((timestamp) => timestamp > now - windowMs);
    if (active.length >= limit) {
      requestsByStreamer.set(streamerId, active);
      return { allowed: false, retryAfterMs: Math.max(1, active[0] + windowMs - now) };
    }
    active.push(now);
    requestsByStreamer.set(streamerId, active);
    if (requestsByStreamer.size > 10_000) {
      for (const [key, timestamps] of requestsByStreamer) {
        const recent = timestamps.filter((timestamp) => timestamp > now - windowMs);
        if (recent.length) requestsByStreamer.set(key, recent);
        else requestsByStreamer.delete(key);
      }
    }
    return { allowed: true, remaining: limit - active.length };
  };
}

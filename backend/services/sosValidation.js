import { INCIDENT_MODULES, INCIDENT_SOURCES } from '../../shared/incident.mjs';

export function validateSosPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON object is required.' };
  const streamer_id = typeof body.streamer_id === 'string' ? body.streamer_id.trim() : '';
  if (!streamer_id || streamer_id.length > 100 || !/^[\w-]+$/.test(streamer_id)) {
    return { ok: false, error: 'streamer_id is required and must contain only letters, numbers, underscores, or hyphens.' };
  }
  const lat = Number(body.location?.lat);
  const lng = Number(body.location?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, error: 'location.lat and location.lng must be valid coordinates.' };
  }
  const module_type = String(body.module_type || 'FULE_PROTECT').toUpperCase();
  if (!INCIDENT_MODULES.includes(module_type)) return { ok: false, error: `module_type must be one of: ${INCIDENT_MODULES.join(', ')}.` };
  const source = body.source || 'button';
  if (!INCIDENT_SOURCES.includes(source)) return { ok: false, error: `source must be one of: ${INCIDENT_SOURCES.join(', ')}.` };
  if (body.audio_transcript_snippet != null && typeof body.audio_transcript_snippet !== 'string') {
    return { ok: false, error: 'audio_transcript_snippet must be a string.' };
  }
  return {
    ok: true,
    value: {
      streamer_id,
      location: { lat, lng, address: 'Simulated location · address withheld publicly' },
      module_type,
      audio_transcript_snippet: String(body.audio_transcript_snippet || '').slice(-4000),
      source
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
    return { allowed: true, remaining: limit - active.length };
  };
}

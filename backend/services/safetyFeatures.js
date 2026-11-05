import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { rankGuardians } from './guardianRanking.js';

const ZERO_HASH = '0'.repeat(64);
const keyFrom = (value) => createHash('sha256').update(String(value)).digest('hex');
export function safeWalkTokenMatches(value, digest) {
  if (typeof value !== 'string' || typeof digest !== 'string') return false;
  const candidate = Buffer.from(keyFrom(value), 'hex');
  const expected = Buffer.from(digest, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
const pinPepper = () => process.env.SAFE_WALK_PIN_PEPPER || process.env.JWT_ACCESS_SECRET || 'local-demo-only-pin-pepper';

export function hashDuressPin(pin) {
  return createHmac('sha256', pinPepper()).update(String(pin)).digest('hex');
}

export function isDuressPin(pin, storedHash) {
  const actual = Buffer.from(hashDuressPin(pin), 'hex');
  let expected;
  try { expected = Buffer.from(String(storedHash || ''), 'hex'); } catch { return false; }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function distanceMeters(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function approximateArea(location) {
  return typeof location?.area_label === 'string' && location.area_label.trim()
    ? location.area_label.trim().slice(0, 120)
    : 'Nearby area';
}

export function matchNearbyGuardians(incidentLocation, guardianLocations, { radiusMeters = 400, limit = 8 } = {}) {
  if (!Number.isFinite(incidentLocation?.lat) || !Number.isFinite(incidentLocation?.lng)) return [];
  return guardianLocations
    .filter((guardian) => guardian?.verified === true && guardian?.on_duty === true && Number.isFinite(guardian.lat) && Number.isFinite(guardian.lng))
    .map((guardian) => ({ guardian_id: String(guardian.guardian_id), distance_m: Math.round(distanceMeters(incidentLocation, guardian)), approximate_area: approximateArea(guardian), response_time_seconds: guardian.response_time_seconds, trust_rating: guardian.trust_rating }))
    .filter((guardian) => guardian.distance_m <= radiusMeters)
    .map((guardian) => ({ ...guardian, ...rankGuardians([guardian], { radiusMeters })[0] }))
    .sort((a, b) => b.ranking_score - a.ranking_score || a.distance_m - b.distance_m)
    .slice(0, limit);
}

export function createEvidenceEntry({ chunk_id, incident_id, sequence, recorded_at, storage_key, sha256, previous_hash, metadata = {} }) {
  const body = JSON.stringify({ chunk_id, incident_id, sequence, recorded_at, storage_key, sha256, previous_hash, metadata });
  return { chunk_id, incident_id, sequence, recorded_at, storage_key, sha256, previous_hash, metadata, chain_hash: createHash('sha256').update(body).digest('hex') };
}

export function verifyEvidenceChain(entries, initialHash = ZERO_HASH) {
  let previous = initialHash;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.sequence !== index + 1 || entry.previous_hash !== previous) return { valid: false, verified: index, reason: 'sequence_or_previous_hash_mismatch' };
    const recomputed = createEvidenceEntry({ ...entry, previous_hash: previous }).chain_hash;
    if (recomputed !== entry.chain_hash) return { valid: false, verified: index, reason: 'chain_hash_mismatch' };
    previous = entry.chain_hash;
  }
  return { valid: true, verified: entries.length, head: previous };
}

export function createSafeWalkWorkflow({ store, queue, notify, triggerSos, now = () => Date.now() }) {
  return {
    async start(input) {
      const walk = {
        walk_id: `walk-${now()}-${randomBytes(8).toString('hex')}`,
        streamer_id: input.streamer_id,
        destination: input.destination.trim().slice(0, 160),
        eta_at: new Date(now() + input.eta_minutes * 60_000).toISOString(),
        check_in_interval_minutes: input.check_in_interval_minutes,
        status: 'ACTIVE',
        location_trail: input.location ? [{ ...input.location, at: new Date(now()).toISOString() }] : [],
        checkin_number: 1,
        created_at: new Date(now()).toISOString()
      };
      const sessionToken = randomBytes(32).toString('base64url');
      await store.create(walk, { duress_pin_hash: hashDuressPin(input.duress_pin), safe_pin_hash: hashDuressPin(input.safe_pin), session_token_hash: keyFrom(sessionToken) });
      try { await queue.scheduleCheckin(walk.walk_id, walk.checkin_number, input.check_in_interval_minutes * 60_000); }
      catch (error) { walk.status = 'SCHEDULING_FAILED'; await store.update(walk); throw error; }
      return { walk, session_token: sessionToken };
    },
    async addLocation(walkId, location) {
      const record = await store.get(walkId);
      if (!record || !['ACTIVE', 'AWAITING_CHECKIN'].includes(record.walk.status)) return null;
      record.walk.location_trail = [...record.walk.location_trail, { lat: location.lat, lng: location.lng, at: new Date(now()).toISOString() }].slice(-500);
      await store.update(record.walk);
      return record.walk;
    },
    async checkin(walkId, token, pin, location) {
      const record = await store.get(walkId);
      if (!record || !safeWalkTokenMatches(token, record.session_token_hash) || !['ACTIVE', 'AWAITING_CHECKIN'].includes(record.walk.status)) return { ok: false };
      if (location) await this.addLocation(walkId, location);
      const latest = await store.get(walkId);
      if (isDuressPin(pin, latest.duress_pin_hash)) {
        const sos = await triggerSos({ streamer_id: latest.walk.streamer_id, location: latest.walk.location_trail.at(-1), source: 'button', silent_public: true, audio_transcript_snippet: 'Silent duress check-in requested immediate assistance.' });
        if (!sos?.incident) throw new Error('Duress SOS could not be created; retrying the protected escalation.');
        await queue.cancelWalkJobs(walkId);
        latest.walk.status = 'CANCELLED';
        latest.walk.incident_id = sos?.incident?.incident_id || null;
        await store.update(latest.walk);
        await notify(latest.walk, { event: 'safe_walk_checkin_completed' });
        return { ok: true, status: 'CHECKED_IN', walk: latest.walk, incident: sos?.incident || null, duress: true };
      }
      if (!isDuressPin(pin, latest.safe_pin_hash)) return { ok: false };
      await queue.cancelWalkJobs(walkId);
      latest.walk.checkin_number += 1;
      latest.walk.last_checkin_at = new Date(now()).toISOString();
      latest.walk.status = 'ACTIVE';
      await store.update(latest.walk);
      await queue.scheduleCheckin(walkId, latest.walk.checkin_number, latest.walk.check_in_interval_minutes * 60_000);
      return { ok: true, status: 'CHECKED_IN', walk: latest.walk };
    },
    async checkinDue(walkId, checkinNumber) {
      const record = await store.get(walkId);
      if (!record || record.walk.status !== 'ACTIVE' || record.walk.checkin_number !== checkinNumber) return false;
      record.walk.status = 'AWAITING_CHECKIN';
      record.walk.checkin_due_at = new Date(now()).toISOString();
      await store.update(record.walk);
      await notify(record.walk, { event: 'safe_walk_checkin_due', countdown_seconds: 60 });
      await queue.scheduleTimeout(walkId, checkinNumber, 60_000);
      return true;
    },
    async timeout(walkId, checkinNumber) {
      const record = await store.get(walkId);
      if (!record || record.walk.status !== 'AWAITING_CHECKIN' || record.walk.checkin_number !== checkinNumber) return false;
      const last = record.walk.location_trail.at(-1) || { lat: null, lng: null };
      const sos = await triggerSos({ streamer_id: record.walk.streamer_id, location: { lat: last.lat, lng: last.lng, address: 'Safe-walk last known location' }, source: 'button', audio_transcript_snippet: `Missed safe-walk check-in. Destination: ${record.walk.destination}. Last known location trail attached.` });
      if (!sos?.incident) throw new Error('Missed check-in SOS could not be created; retrying escalation.');
      record.walk.status = 'SOS_TRIGGERED';
      record.walk.incident_id = sos?.incident?.incident_id || null;
      await store.update(record.walk);
      await notify(record.walk, { event: 'safe_walk_sos_triggered', incident_id: record.walk.incident_id, incident: sos.incident, streamer_cancel_token: sos.streamer_cancel_token });
      return sos;
    },
    async cancel(walkId, token) {
      const record = await store.get(walkId);
      if (!record || !safeWalkTokenMatches(token, record.session_token_hash) || !['ACTIVE', 'AWAITING_CHECKIN'].includes(record.walk.status)) return false;
      await queue.cancelWalkJobs(walkId);
      record.walk.status = 'CANCELLED';
      await store.update(record.walk);
      return true;
    }
  };
}

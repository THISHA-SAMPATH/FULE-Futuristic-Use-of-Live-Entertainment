import { incidentRepository } from './incidentStore.js';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const statePath = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)), 'safety-features.json');
function readState() {
  if (!existsSync(statePath)) return {};
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return {}; }
}
const initialState = readState();
const walks = new Map(Object.entries(initialState.walks || {}));
const duty = new Map(Object.entries(initialState.duty || {}));
const evidence = new Map(Object.entries(initialState.evidence || {}));
const pushSubscriptions = new Map(Object.entries(initialState.pushSubscriptions || {}));
const memoryLists = new Map(Object.entries(initialState.lists || {}).map(([key, values]) => [key, new Set(values)]));
function persistDemoState() {
  mkdirSync(dirname(statePath), { recursive: true });
  const lists = Object.fromEntries([...memoryLists].map(([key, values]) => [key, [...values]]));
  const temporary = `${statePath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ walks: Object.fromEntries(walks), duty: Object.fromEntries(duty), evidence: Object.fromEntries(evidence), pushSubscriptions: Object.fromEntries(pushSubscriptions), lists })}\n`, { mode: 0o600 });
  renameSync(temporary, statePath);
}

export const safetyFeatureStore = {
  async create(walk, hashes) {
    const value = { walk, ...hashes };
    if (incidentRepository.db) {
      await incidentRepository.db('safe_walks').insert({ walk_id: walk.walk_id, streamer_id: walk.streamer_id, status: walk.status, payload: JSON.stringify(walk), ...hashes });
    } else { walks.set(walk.walk_id, value); persistDemoState(); }
    return value;
  },
  async get(id) {
    if (incidentRepository.db) {
      const row = await incidentRepository.db('safe_walks').where({ walk_id: id }).first();
      return row ? { walk: row.payload, duress_pin_hash: row.duress_pin_hash, safe_pin_hash: row.safe_pin_hash, session_token_hash: row.session_token_hash } : null;
    }
    return walks.get(id) || null;
  },
  async update(walk) {
    const current = await this.get(walk.walk_id);
    if (!current) return null;
    if (incidentRepository.db) await incidentRepository.db('safe_walks').where({ walk_id: walk.walk_id }).update({ status: walk.status, payload: JSON.stringify(walk), updated_at: new Date() });
    else { walks.set(walk.walk_id, { ...current, walk }); persistDemoState(); }
    return walk;
  },
  async walksForIncident(incidentId) {
    if (incidentRepository.db) return (await incidentRepository.db('safe_walks').select('payload').whereRaw("payload->>'incident_id' = ?", [incidentId])).map((row) => row.payload);
    return [...walks.values()].map((entry) => entry.walk).filter((walk) => walk.incident_id === incidentId);
  },
  async saveDutyLocation(guardianId, location) {
    const record = { guardian_id: guardianId, ...location, updated_at: Date.now(), verified: true, on_duty: true };
    if (incidentRepository.db) await incidentRepository.db('guardian_duty_locations').insert({ guardian_id: guardianId, lat: location.lat, lng: location.lng, area_label: location.area_label, updated_at: new Date() }).onConflict('guardian_id').merge();
    else { duty.set(guardianId, record); persistDemoState(); }
    return record;
  },
  async removeDutyLocation(guardianId) {
    if (incidentRepository.db) await incidentRepository.db('guardian_duty_locations').where({ guardian_id: guardianId }).del();
    else { duty.delete(guardianId); persistDemoState(); }
  },
  async getDutyLocation(guardianId) {
    if (incidentRepository.db) {
      const row = await incidentRepository.db('guardian_duty_locations').where({ guardian_id: guardianId }).where('updated_at', '>', new Date(Date.now() - 15 * 60_000)).first('area_label', 'updated_at');
      return row ? { area_label: row.area_label, updated_at: row.updated_at } : null;
    }
    const record = duty.get(guardianId);
    return record && Date.now() - record.updated_at <= 15 * 60_000 ? { area_label: record.area_label, updated_at: record.updated_at } : null;
  },
  async savePushSubscription(streamerId, subscription) {
    const endpointHash = createHash('sha256').update(subscription.endpoint).digest('hex');
    if (incidentRepository.db) await incidentRepository.db.transaction(async (trx) => {
      const current = await trx('safe_walk_push_subscriptions').where({ streamer_id: streamerId }).orderBy('updated_at', 'asc').select('endpoint_hash');
      if (!current.some((entry) => entry.endpoint_hash === endpointHash) && current.length >= 5) await trx('safe_walk_push_subscriptions').where({ streamer_id: streamerId, endpoint_hash: current[0].endpoint_hash }).del();
      await trx('safe_walk_push_subscriptions').insert({ streamer_id: streamerId, endpoint_hash: endpointHash, subscription: JSON.stringify(subscription), updated_at: new Date() }).onConflict(['streamer_id', 'endpoint_hash']).merge();
    });
    else {
      const values = pushSubscriptions.get(streamerId) || {};
      if (!values[endpointHash] && Object.keys(values).length >= 5) delete values[Object.keys(values)[0]];
      values[endpointHash] = subscription; pushSubscriptions.set(streamerId, values); persistDemoState();
    }
  },
  async removePushSubscription(streamerId, endpoint) {
    const endpointHash = createHash('sha256').update(endpoint).digest('hex');
    if (incidentRepository.db) await incidentRepository.db('safe_walk_push_subscriptions').where({ streamer_id: streamerId, endpoint_hash: endpointHash }).del();
    else { const values = pushSubscriptions.get(streamerId) || {}; delete values[endpointHash]; pushSubscriptions.set(streamerId, values); persistDemoState(); }
  },
  async loadPushSubscriptions(streamerId) {
    if (incidentRepository.db) return (await incidentRepository.db('safe_walk_push_subscriptions').where({ streamer_id: streamerId }).select('subscription')).map((row) => row.subscription);
    return Object.values(pushSubscriptions.get(streamerId) || {});
  },
  async listDutyLocations() {
    const records = incidentRepository.db
      ? (await incidentRepository.db('guardian_duty_locations').select('guardian_id', 'lat', 'lng', 'area_label', 'updated_at')).map((row) => ({ guardian_id: row.guardian_id, lat: Number(row.lat), lng: Number(row.lng), area_label: row.area_label, updated_at: new Date(row.updated_at).getTime(), verified: true, on_duty: true }))
      : [...duty.values()];
    return records.filter((record) => Date.now() - record.updated_at <= 15 * 60_000);
  },
  async nearbyDutyLocations(location, radiusMeters) {
    if (!incidentRepository.db) return this.listDutyLocations();
    const latDelta = radiusMeters / 110_574;
    const lngDelta = radiusMeters / Math.max(1, 111_320 * Math.cos(location.lat * Math.PI / 180));
    const rows = await incidentRepository.db('guardian_duty_locations').select('guardian_id', 'lat', 'lng', 'area_label', 'updated_at')
      .whereBetween('lat', [location.lat - latDelta, location.lat + latDelta])
      .whereBetween('lng', [location.lng - lngDelta, location.lng + lngDelta])
      .where('updated_at', '>', new Date(Date.now() - 15 * 60_000));
    return rows.map((row) => ({ guardian_id: row.guardian_id, lat: Number(row.lat), lng: Number(row.lng), area_label: row.area_label, updated_at: new Date(row.updated_at).getTime(), verified: true, on_duty: true }));
  },
  async acceptNearbyGuardian(incidentId, guardianId, maxAccepted = 5) {
    if (incidentRepository.db) return incidentRepository.db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [incidentId]);
      const offer = await trx('nearby_guardian_offers').where({ incident_id: incidentId, guardian_id: guardianId }).forUpdate().first();
      if (!offer) return { accepted: false, count: Number((await trx('nearby_guardian_offers').where({ incident_id: incidentId }).whereNotNull('accepted_at').count({ count: '*' }).first()).count) };
      const count = Number((await trx('nearby_guardian_offers').where({ incident_id: incidentId }).whereNotNull('accepted_at').count({ count: '*' }).first()).count);
      if (offer.accepted_at) return { accepted: true, count };
      if (count >= maxAccepted) return { accepted: false, count };
      await trx('nearby_guardian_offers').where({ incident_id: incidentId, guardian_id: guardianId }).update({ accepted_at: new Date() });
      return { accepted: true, count: count + 1 };
    });
    const key = `accepts:${incidentId}`;
    const list = memoryLists.get(key) || new Set();
    const offered = memoryLists.get(`offers:${incidentId}`);
    if (!offered?.has(guardianId)) return { accepted: false, count: list.size };
    if (list.has(guardianId)) return { accepted: true, count: list.size };
    if (list.size >= maxAccepted) return { accepted: false, count: list.size };
    list.add(guardianId); memoryLists.set(key, list); persistDemoState();
    return { accepted: true, count: list.size };
  },
  async saveNearbyOffers(incidentId, responders) {
    if (incidentRepository.db) {
      if (!responders.length) return;
      await incidentRepository.db('nearby_guardian_offers').insert(responders.map((guardian, index) => ({ incident_id: incidentId, guardian_id: guardian.guardian_id, priority: index + 1, approximate_area: guardian.approximate_area }))).onConflict(['incident_id', 'guardian_id']).ignore();
    } else { memoryLists.set(`offers:${incidentId}`, new Set(responders.map((guardian) => guardian.guardian_id))); persistDemoState(); }
  },
  async nearbyGuardianCount(incidentId) {
    if (incidentRepository.db) return Number((await incidentRepository.db('nearby_guardian_offers').where({ incident_id: incidentId }).whereNotNull('accepted_at').count({ count: '*' }).first()).count);
    return memoryLists.get(`accepts:${incidentId}`)?.size || 0;
  },
  async nearbyOfferStates(incidentId) {
    if (incidentRepository.db) return incidentRepository.db('nearby_guardian_offers').where({ incident_id: incidentId }).select('guardian_id', 'accepted_at', 'approximate_area');
    const offers = memoryLists.get(`offers:${incidentId}`) || new Set();
    const accepted = memoryLists.get(`accepts:${incidentId}`) || new Set();
    return [...offers].map((guardian_id) => ({ guardian_id, accepted_at: accepted.has(guardian_id) ? new Date().toISOString() : null, approximate_area: 'Nearby area' }));
  },
  async guardianHasPendingOffer(incidentId, guardianId) {
    if (incidentRepository.db) return Boolean(await incidentRepository.db('nearby_guardian_offers').where({ incident_id: incidentId, guardian_id }).whereNull('accepted_at').first('guardian_id'));
    return Boolean(memoryLists.get(`offers:${incidentId}`)?.has(guardianId) && !memoryLists.get(`accepts:${incidentId}`)?.has(guardianId));
  },
  async guardianHasAcceptedOffer(incidentId, guardianId) {
    if (incidentRepository.db) return Boolean(await incidentRepository.db('nearby_guardian_offers').where({ incident_id: incidentId, guardian_id: guardianId }).whereNotNull('accepted_at').first('guardian_id'));
    return Boolean(memoryLists.get(`accepts:${incidentId}`)?.has(guardianId));
  },
  async appendEvidence(entry) {
    if (incidentRepository.db) {
      return incidentRepository.db.transaction(async (trx) => {
        await trx('evidence_chain_heads').insert({ incident_id: entry.incident_id }).onConflict('incident_id').ignore();
        const head = await trx('evidence_chain_heads').where({ incident_id: entry.incident_id }).forUpdate().first();
        const next = entry.build(head.last_seq + 1, head.last_hash);
        await trx('evidence_chunks').insert(next);
        await trx('evidence_chain_heads').where({ incident_id: entry.incident_id }).update({ last_seq: next.sequence, last_hash: next.chain_hash });
        return next;
      });
    }
    const rows = evidence.get(entry.incident_id) || [];
    const next = entry.build(rows.length + 1, rows.at(-1)?.chain_hash || '0'.repeat(64));
    rows.push(next); evidence.set(entry.incident_id, rows); persistDemoState();
    return next;
  },
  async listEvidence(incidentId) {
    if (incidentRepository.db) return incidentRepository.db('evidence_chunks').where({ incident_id: incidentId }).orderBy('sequence').select('*');
    return evidence.get(incidentId) || [];
  },
  async listExpiredStreamRecordings(cutoff) {
    if (incidentRepository.db) {
      const rows = await incidentRepository.db('evidence_chunks').whereRaw("metadata->>'source' = 'livekit_egress'").where('recorded_at', '<', cutoff).select('*');
      const tombstones = await incidentRepository.db('evidence_chunks').whereRaw("metadata->>'source' = 'retention_tombstone'").select('metadata');
      const expired = new Set(tombstones.map((row) => row.metadata.target_chunk_id));
      return rows.filter((row) => !expired.has(row.chunk_id));
    }
    const rows = [...evidence.values()].flat();
    const expired = new Set(rows.filter((entry) => entry.metadata?.source === 'retention_tombstone').map((entry) => entry.metadata.target_chunk_id));
    return rows.filter((entry) => entry.metadata?.source === 'livekit_egress' && !expired.has(entry.chunk_id) && Date.parse(entry.recorded_at) < cutoff.getTime());
  }
};

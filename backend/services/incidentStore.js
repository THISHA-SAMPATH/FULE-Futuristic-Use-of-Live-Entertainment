import { createIncidentRepository } from './incidentRepository.js';
import { log } from './securityMetrics.js';

export const incidentRepository = createIncidentRepository();
await incidentRepository.initialize();
const incidentCache = new Map((incidentRepository.db ? await incidentRepository.loadActiveIncidents() : await incidentRepository.loadIncidents()).map((incident) => [incident.incident_id, incident]));
const trustedContactCache = new Map(incidentRepository.db ? [] : Object.entries(await incidentRepository.loadAllTrustedContacts()));
const falseAlarmCache = new Map(incidentRepository.db ? [] : Object.entries(await incidentRepository.loadFalseAlarmCounts()).map(([id, count]) => [id, Number(count)]));
let pendingWrites = Promise.resolve();

function enqueue(operation) {
  pendingWrites = pendingWrites.then(operation).catch((error) => { log('error', 'repository_write_failed', { error: error.message }); });
  return pendingWrites;
}

export function loadIncidents() { return [...incidentCache.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)); }
export async function getIncident(incidentId) {
  const incident = await incidentRepository.loadIncident(incidentId);
  if (incident) incidentCache.set(incidentId, incident);
  return incident || incidentCache.get(incidentId) || null;
}
export async function listIncidentPage({ limit = 100, offset = 0 } = {}) { return incidentRepository.listIncidents({ limit, offset }); }
export async function listDispatchQueue({ limit = 100 } = {}) { return incidentRepository.listDispatchQueue({ limit }); }
export function persistIncident(incident) {
  incidentCache.set(incident.incident_id, incident);
  return enqueue(() => incidentRepository.persistIncident(incident));
}
export function removeIncident(incidentId) {
  incidentCache.delete(incidentId);
  return enqueue(() => incidentRepository.removeIncident(incidentId));
}
export function loadTrustedContacts(streamerId) { return trustedContactCache.get(streamerId) || []; }
export async function loadTrustedContactsFresh(streamerId) {
  const contacts = await incidentRepository.loadTrustedContacts(streamerId);
  trustedContactCache.set(streamerId, contacts);
  return contacts;
}
export function saveTrustedContacts(streamerId, contacts) {
  trustedContactCache.set(streamerId, contacts);
  return enqueue(() => incidentRepository.saveTrustedContacts(streamerId, contacts));
}
export async function recordFalseAlarm(streamerId) {
  const count = await incidentRepository.recordFalseAlarm(streamerId);
  falseAlarmCache.set(streamerId, count);
  return count;
}
export function appendRepositoryAudit(entry) { return enqueue(() => incidentRepository.appendAudit(entry)); }
export async function flushIncidentWrites() { await pendingWrites; }
export async function cleanupIncidentData(retentionDays = Number(process.env.INCIDENT_RETENTION_DAYS) || 90) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  for (const [id, incident] of incidentCache) if (Date.parse(incident.created_at) < cutoff.getTime()) incidentCache.delete(id);
  await incidentRepository.cleanupBefore(cutoff);
  return cutoff;
}
export async function closeIncidentStore() { await flushIncidentWrites(); await incidentRepository.close(); }

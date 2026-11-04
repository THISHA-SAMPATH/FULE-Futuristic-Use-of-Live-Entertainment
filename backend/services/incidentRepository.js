import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import knexFactory from 'knex';

const dataDir = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)));

export class FileIncidentRepository {
  constructor(directory = dataDir) { this.directory = directory; this.path = resolve(directory, 'incidents.json'); this.contactsPath = resolve(directory, 'trusted-contacts.json'); this.falseAlarmPath = resolve(directory, 'false-alarms.json'); }
  async initialize() { mkdirSync(this.directory, { recursive: true }); }
  #read(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } }
  #write(path, value) { mkdirSync(this.directory, { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
  loadIncidents() { return Object.values(this.#read(this.path, {})).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)); }
  loadActiveIncidents() { return this.loadIncidents().filter((incident) => ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(incident.status)); }
  listIncidents({ limit = 100, offset = 0 } = {}) { return this.loadIncidents().slice(offset, offset + limit); }
  listDispatchQueue({ limit = 100 } = {}) { return this.loadIncidents().filter((incident) => incident.dispatch_record && !['RESOLVED', 'STAND_DOWN'].includes(incident.dispatch_stage)).slice(0, limit); }
  loadIncident(id) { return this.#read(this.path, {})[id] || null; }
  persistIncident(incident) { const all = this.#read(this.path, {}); all[incident.incident_id] = incident; this.#write(this.path, all); }
  removeIncident(id) { const all = this.#read(this.path, {}); delete all[id]; this.#write(this.path, all); }
  loadTrustedContacts(id) { return this.#read(this.contactsPath, {})[id] || []; }
  loadAllTrustedContacts() { return this.#read(this.contactsPath, {}); }
  loadFalseAlarmCounts() { return this.#read(this.falseAlarmPath, {}); }
  saveTrustedContacts(id, contacts) { const all = this.#read(this.contactsPath, {}); all[id] = contacts; this.#write(this.contactsPath, all); }
  recordFalseAlarm(id) { const all = this.#read(this.falseAlarmPath, {}); all[id] = (all[id] || 0) + 1; this.#write(this.falseAlarmPath, all); return all[id]; }
  appendAudit(entry) { const path = resolve(this.directory, 'audit.jsonl'); appendFileSync(path, `${JSON.stringify(entry)}\n`); }
  async cleanupBefore(date) {
    const incidents = this.#read(this.path, {});
    for (const [id, incident] of Object.entries(incidents)) if (Date.parse(incident.created_at) < date.getTime()) delete incidents[id];
    this.#write(this.path, incidents);
    const auditPath = resolve(this.directory, 'audit.jsonl');
    try {
      const lines = readFileSync(auditPath, 'utf8').split(/\r?\n/).filter(Boolean).filter((line) => Date.parse(JSON.parse(line).at || 0) >= date.getTime());
      writeFileSync(auditPath, `${lines.join('\n')}${lines.length ? '\n' : ''}`);
    } catch { /* No prior audit file to clean. */ }
  }
  async close() { }
}

export class MemoryIncidentRepository {
  constructor() { this.incidents = new Map(); this.contacts = new Map(); this.falseAlarms = new Map(); this.audit = []; }
  async initialize() { }
  loadIncidents() { return [...this.incidents.values()]; }
  loadActiveIncidents() { return this.loadIncidents().filter((incident) => ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(incident.status)); }
  listIncidents({ limit = 100, offset = 0 } = {}) { return this.loadIncidents().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(offset, offset + limit); }
  listDispatchQueue({ limit = 100 } = {}) { return this.listIncidents({ limit: 10_000 }).filter((incident) => incident.dispatch_record && !['RESOLVED', 'STAND_DOWN'].includes(incident.dispatch_stage)).slice(0, limit); }
  loadIncident(id) { return this.incidents.get(id) || null; }
  persistIncident(incident) { this.incidents.set(incident.incident_id, incident); }
  removeIncident(id) { this.incidents.delete(id); }
  loadTrustedContacts(id) { return this.contacts.get(id) || []; }
  loadAllTrustedContacts() { return Object.fromEntries(this.contacts); }
  loadFalseAlarmCounts() { return Object.fromEntries(this.falseAlarms); }
  saveTrustedContacts(id, contacts) { this.contacts.set(id, contacts); }
  recordFalseAlarm(id) { const count = (this.falseAlarms.get(id) || 0) + 1; this.falseAlarms.set(id, count); return count; }
  appendAudit(entry) { this.audit.push(entry); }
  async cleanupBefore(date) { for (const [id, incident] of this.incidents) if (Date.parse(incident.created_at) < date.getTime()) this.incidents.delete(id); }
  async close() { }
}

export class PostgresIncidentRepository {
  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL storage.');
    this.db = knexFactory({ client: 'pg', connection: { connectionString, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' } : undefined }, pool: { min: 2, max: Number(process.env.PG_POOL_MAX) || 20 }, migrations: { directory: fileURLToPath(new URL('../migrations/', import.meta.url)), extension: 'mjs', loadExtensions: ['.mjs'] } });
  }
  async initialize() { await this.db.migrate.latest(); }
  async loadIncidents() { return (await this.db('incidents').select('payload').orderBy('created_at', 'desc')).map((row) => row.payload); }
  async loadActiveIncidents() { return (await this.db('incidents').select('payload').whereIn('status', ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED']).orderBy('created_at', 'desc')).map((row) => row.payload); }
  async listIncidents({ limit = 100, offset = 0 } = {}) { return (await this.db('incidents').select('payload').orderBy('created_at', 'desc').limit(limit).offset(offset)).map((row) => row.payload); }
  async listDispatchQueue({ limit = 100 } = {}) { return (await this.db('incidents').select('payload').whereIn('status', ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED']).orderBy('created_at', 'desc').limit(Math.min(500, limit * 5))).map((row) => row.payload).filter((incident) => incident.dispatch_record && !['RESOLVED', 'STAND_DOWN'].includes(incident.dispatch_stage)).slice(0, limit); }
  async loadIncident(id) { return (await this.db('incidents').where({ incident_id: id }).first('payload'))?.payload || null; }
  async persistIncident(incident) { await this.db('incidents').insert({ incident_id: incident.incident_id, created_at: new Date(incident.created_at), status: incident.status, streamer_id: incident.streamer_id || incident.streamer_contact?.streamer_id || '', payload: JSON.stringify(incident) }).onConflict('incident_id').merge(); }
  async removeIncident(id) { await this.db('incidents').where({ incident_id: id }).del(); }
  async loadTrustedContacts(id) { const row = await this.db('trusted_contacts').where({ streamer_id: id }).first('contacts'); return row?.contacts || []; }
  async loadAllTrustedContacts() { return Object.fromEntries((await this.db('trusted_contacts').select('streamer_id', 'contacts')).map(({ streamer_id, contacts }) => [streamer_id, contacts])); }
  async loadFalseAlarmCounts() { return Object.fromEntries((await this.db('false_alarm_counts').select('streamer_id', 'count')).map(({ streamer_id, count }) => [streamer_id, Number(count)])); }
  async saveTrustedContacts(id, contacts) { await this.db('trusted_contacts').insert({ streamer_id: id, contacts: JSON.stringify(contacts), updated_at: new Date() }).onConflict('streamer_id').merge(); }
  async recordFalseAlarm(id) { const [row] = await this.db('false_alarm_counts').insert({ streamer_id: id, count: 1, updated_at: new Date() }).onConflict('streamer_id').merge({ count: this.db.raw('false_alarm_counts.count + 1'), updated_at: new Date() }).returning('count'); return Number(row.count); }
  async appendAudit(entry) { await this.db('audit_events').insert({ event: entry.event || 'STATE_CHANGE', incident_id: entry.incident_id || null, actor_id: entry.actor_id || null, payload: JSON.stringify(entry), created_at: new Date(entry.at || Date.now()) }); }
  async cleanupBefore(date) { await this.db('incidents').where('created_at', '<', date).del(); await this.db('audit_events').where('created_at', '<', date).del(); await this.db('idempotency_keys').where('created_at', '<', date).del(); await this.db('false_alarm_counts').where('updated_at', '<', date).del(); await this.db('streamer_incident_sessions').where('expires_at', '<', new Date()).del(); await this.db('refresh_tokens').where((query) => query.where('expires_at', '<', new Date()).orWhereNotNull('revoked_at')).del(); }
  async close() { await this.db.destroy(); }
}

export function createIncidentRepository({ env = process.env } = {}) {
  if (env.DATABASE_URL) return new PostgresIncidentRepository(env.DATABASE_URL);
  if (env.NODE_ENV === 'production') throw new Error('Production requires DATABASE_URL; file storage is disabled.');
  if (env.FULE_STORAGE === 'memory') return new MemoryIncidentRepository();
  return new FileIncidentRepository();
}

import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createIncidentRepository } from '../services/incidentRepository.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running this migration.');
const source = process.argv[2];
if (!source) throw new Error('Usage: npm run migrate:sqlite -- path/to/incidents.sqlite');
const sqlite = new DatabaseSync(source, { readOnly: true });
const repository = createIncidentRepository();
await repository.initialize();
try {
  for (const { payload } of sqlite.prepare('SELECT payload FROM incidents').all()) await repository.persistIncident(JSON.parse(payload));
  for (const { streamer_id, contacts } of sqlite.prepare('SELECT streamer_id, contacts FROM trusted_contacts').all()) await repository.saveTrustedContacts(streamer_id, JSON.parse(contacts));
  for (const { streamer_id, count, updated_at } of sqlite.prepare('SELECT streamer_id, count, updated_at FROM false_alarm_counts').all()) {
    await repository.db('false_alarm_counts').insert({ streamer_id, count, updated_at: new Date(updated_at) }).onConflict('streamer_id').merge();
  }
  const auditFile = resolve(dirname(source), 'audit.jsonl');
  if (existsSync(auditFile)) {
    for (const line of readFileSync(auditFile, 'utf8').split(/\r?\n/).filter(Boolean)) await repository.appendAudit(JSON.parse(line));
  }
  process.stdout.write('SQLite incidents, trusted contacts, false-alarm counts, and adjacent audit events copied to PostgreSQL.\n');
} finally { sqlite.close(); await repository.close(); }

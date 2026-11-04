import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const dataDirectory = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)));
mkdirSync(dataDirectory, { recursive: true });
const databasePath = resolve(dataDirectory, 'incidents.sqlite');
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS incidents (
    incident_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS incidents_created_at ON incidents(created_at DESC);
`);

const saveStatement = database.prepare(`
  INSERT INTO incidents (incident_id, created_at, status, payload)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(incident_id) DO UPDATE SET
    created_at = excluded.created_at,
    status = excluded.status,
    payload = excluded.payload
`);
const deleteStatement = database.prepare('DELETE FROM incidents WHERE incident_id = ?');

export function loadIncidents() {
  return database.prepare('SELECT payload FROM incidents ORDER BY created_at DESC').all()
    .map(({ payload }) => JSON.parse(payload));
}

export function persistIncident(incident) {
  saveStatement.run(incident.incident_id, incident.created_at, incident.status, JSON.stringify(incident));
}

export function removeIncident(incidentId) {
  deleteStatement.run(incidentId);
}

export function closeIncidentStore() {
  database.close();
}

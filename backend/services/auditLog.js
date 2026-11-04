import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const dataDirectory = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)));
const auditPath = resolve(dataDirectory, 'audit.jsonl');

export function writeAudit(entry) {
  mkdirSync(dataDirectory, { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

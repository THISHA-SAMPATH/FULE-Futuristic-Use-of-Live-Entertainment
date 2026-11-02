import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataDirectory = fileURLToPath(new URL('../data/', import.meta.url));
const auditPath = fileURLToPath(new URL('../data/audit.jsonl', import.meta.url));

export function writeAudit(entry) {
  mkdirSync(dataDirectory, { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

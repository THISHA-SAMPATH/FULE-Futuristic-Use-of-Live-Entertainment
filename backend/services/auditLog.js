import { appendRepositoryAudit } from './incidentStore.js';

export function writeAudit(entry) {
  return appendRepositoryAudit({ at: new Date().toISOString(), ...entry });
}

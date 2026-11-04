import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required.');
const { createIncidentRepository } = await import('../services/incidentRepository.js');
const repository = createIncidentRepository();
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
const id = `infra-check-${randomUUID()}`;
try {
  await repository.initialize();
  await redis.ping();
  const incident = { incident_id: id, created_at: new Date().toISOString(), status: 'PENDING_DISPATCH', streamer_id: `${id}-streamer`, location: { lat: 12.34, lng: 56.78 } };
  await repository.persistIncident(incident);
  const stored = await repository.loadIncident(id);
  if (stored?.incident_id !== id || stored.location.lat !== 12.34) throw new Error('PostgreSQL incident read/write verification failed.');
  await repository.saveTrustedContacts(incident.streamer_id, [{ name: 'Infra test', phone: '+14155550123' }]);
  if ((await repository.loadTrustedContacts(incident.streamer_id)).length !== 1) throw new Error('PostgreSQL trusted-contact verification failed.');
  await repository.appendAudit({ event: 'INFRASTRUCTURE_CHECK', incident_id: id, at: new Date().toISOString() });
  if (await repository.recordFalseAlarm(incident.streamer_id) !== 1) throw new Error('PostgreSQL false-alarm counter verification failed.');
  await repository.removeIncident(id);
  await repository.db('audit_events').where({ incident_id: id }).del();
  await repository.db('trusted_contacts').where({ streamer_id: incident.streamer_id }).del();
  await repository.db('false_alarm_counts').where({ streamer_id: incident.streamer_id }).del();
  process.stdout.write('PostgreSQL migration/read-write and Redis ping checks passed.\n');
} finally { await redis.quit(); await repository.close(); }

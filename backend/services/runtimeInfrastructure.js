import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { Queue, Worker } from 'bullmq';

const production = process.env.NODE_ENV === 'production';
const redisUrl = process.env.REDIS_URL;
export const redisEnabled = Boolean(redisUrl);
if (production && !redisUrl) throw new Error('REDIS_URL is required in production.');

export const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, retryStrategy: (attempt) => Math.min(attempt * 250, 5000) }) : null;
export const socketRedisPub = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null, retryStrategy: (attempt) => Math.min(attempt * 250, 5000) }) : null;
export const socketRedisSub = socketRedisPub?.duplicate();
export function installSocketAdapter(io) { if (socketRedisPub && socketRedisSub) io.adapter(createAdapter(socketRedisPub, socketRedisSub)); }
export async function verifyRuntimeInfrastructure() {
  const clients = [redis, socketRedisPub, socketRedisSub].filter(Boolean);
  await Promise.all(clients.map((client) => client.ping()));
}

export const escalationQueue = redisUrl ? new Queue('fule-escalations', { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) }) : null;
let escalationWorker;
let cleanupQueue;
let cleanupWorker;

export async function scheduleEscalationJobs(incidentId, { contactsDelayMs, dispatchDelayMs }) {
  if (!escalationQueue) return false;
  await escalationQueue.add('trusted-contacts', { incidentId }, { jobId: `${incidentId}:contacts`, delay: contactsDelayMs, removeOnComplete: true, removeOnFail: 1000 });
  await escalationQueue.add('dispatch', { incidentId }, { jobId: `${incidentId}:dispatch`, delay: dispatchDelayMs, removeOnComplete: true, removeOnFail: 1000 });
  return true;
}
export async function cancelEscalationJobs(incidentId) {
  if (!escalationQueue) return;
  for (const name of ['contacts', 'dispatch']) {
    const job = await escalationQueue.getJob(`${incidentId}:${name}`);
    if (job && await job.getState() === 'delayed') await job.remove();
  }
}
export async function startBackgroundWorkers({ onContact, onDispatch, onCleanup }) {
  if (!redisUrl) return;
  escalationWorker = new Worker('fule-escalations', async (job) => {
    if (job.name === 'trusted-contacts') await onContact(job.data.incidentId);
    if (job.name === 'dispatch') await onDispatch(job.data.incidentId);
  }, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), concurrency: 20 });
  cleanupQueue = new Queue('fule-maintenance', { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
  await cleanupQueue.upsertJobScheduler('incident-retention-cleanup', { every: 60 * 60 * 1000 }, { name: 'cleanup', data: {} });
  cleanupWorker = new Worker('fule-maintenance', onCleanup, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), concurrency: 1 });
}
export async function closeRuntimeInfrastructure() {
  await Promise.allSettled([escalationWorker?.close(), cleanupWorker?.close(), escalationQueue?.close(), cleanupQueue?.close(), redis?.quit(), socketRedisPub?.quit(), socketRedisSub?.quit()]);
}

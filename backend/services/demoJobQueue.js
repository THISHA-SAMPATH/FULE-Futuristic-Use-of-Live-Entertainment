import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)), 'demo-jobs.json');
const lockPath = `${path}.lock`;
let polling;
let handlers;
let writes = Promise.resolve();

function reportQueueError(error) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', message: 'demo_job_queue_failed', error: error.message }));
}

function readJobs() {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return [];
  try { const value = JSON.parse(readFileSync(path, 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; }
}
async function withFileLock(operation) {
  mkdirSync(dirname(path), { recursive: true });
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + 15_000;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(token);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const [metadata, owner] = await Promise.all([stat(lockPath), readFile(lockPath, 'utf8')]);
        if (Date.now() - metadata.mtimeMs > 30_000 && owner === await readFile(lockPath, 'utf8')) await unlink(lockPath);
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw lockError;
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the demo job queue file lock.');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    try {
      if (await readFile(lockPath, 'utf8') === token) await unlink(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function update(operation) {
  const task = writes.catch(() => {}).then(() => withFileLock(() => {
    const jobs = readJobs();
    const result = operation(jobs);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(jobs)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
      return result;
    } finally {
      if (existsSync(temporary)) unlink(temporary).catch(reportQueueError);
    }
  }));
  writes = task.catch(() => {});
  return task;
}

export const demoJobQueue = {
  async add(name, id, data, delay) {
    await update((jobs) => {
      const existing = jobs.find((job) => job.id === id);
      if (existing && ['waiting', 'active'].includes(existing.state)) return;
      const next = { id, name, data, due_at: Date.now() + Math.max(0, delay), state: 'waiting', attempts: existing?.attempts || 0 };
      if (existing) jobs.splice(jobs.indexOf(existing), 1, next); else jobs.push(next);
    });
  },
  async cancelWalk(walkId) { await update((jobs) => { for (const job of jobs) if (job.data.walkId === walkId && job.state === 'waiting') job.state = 'cancelled'; }); },
  start(nextHandlers) {
    if (!process.env.DEMO_MODE || process.env.DEMO_MODE !== 'true') return;
    handlers = nextHandlers;
    void update((jobs) => { for (const job of jobs) if (job.state === 'active') job.state = 'waiting'; }).catch(reportQueueError);
    const poll = () => { void this.processDue().catch(reportQueueError); };
    polling ||= setInterval(poll, 250);
    polling.unref?.();
    poll();
  },
  async processDue() {
    if (!handlers) return;
    const claimed = [];
    await update((jobs) => {
      for (const job of jobs) {
        if (job.state === 'waiting' && job.due_at <= Date.now()) { job.state = 'active'; claimed.push({ ...job }); }
        if (job.state === 'completed' || job.state === 'cancelled') continue;
      }
    });
    for (const job of claimed) {
      try {
        await handlers[job.name]?.(job.data.walkId, job.data.checkinNumber);
        await update((jobs) => { const current = jobs.find((item) => item.id === job.id); if (current) current.state = 'completed'; });
      } catch {
        await update((jobs) => { const current = jobs.find((item) => item.id === job.id); if (current) { current.attempts += 1; current.state = current.attempts >= 5 ? 'failed' : 'waiting'; current.due_at = Date.now() + Math.min(30_000, 1_000 * 2 ** current.attempts); } });
      }
    }
  },
  stop() { if (polling) clearInterval(polling); polling = null; handlers = null; }
};

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)), 'demo-jobs.json');
const lockPath = `${path}.lock`;
let polling;
let handlers;
let writes = Promise.resolve();

const sleep = (delay) => new Promise((resolveDelay) => setTimeout(resolveDelay, delay));

export function isLockOwnerAlive(owner, { killProcess = process.kill } = {}) {
  const pid = Number.parseInt(String(owner).split(':', 1)[0], 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    killProcess(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

async function removeStaleLock() {
  try {
    const [metadata, owner] = await Promise.all([stat(lockPath), readFile(lockPath, 'utf8')]);
    const ageMs = Date.now() - metadata.mtimeMs;
    if (ageMs <= 30_000 || isLockOwnerAlive(owner)) return;

    // Confirm the same lock is still present before unlinking it. A process
    // may have released and reacquired the path while we checked the owner.
    const [latestMetadata, latestOwner] = await Promise.all([stat(lockPath), readFile(lockPath, 'utf8')]);
    if (metadata.ino !== latestMetadata.ino || owner !== latestOwner) return;
    await unlink(lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

// Windows sync clients (including OneDrive) can briefly hold the destination
// while scanning a replacement. Retry those sharing violations before failing
// the durable queue update.
export async function renameWithRetry(source, destination, {
  renameFile = rename,
  wait = sleep,
  retries = 12,
  initialDelayMs = 40,
  maxDelayMs = 1_000
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      const transientLock = ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (!transientLock || attempt >= retries) throw error;
      await wait(Math.min(maxDelayMs, initialDelayMs * (2 ** attempt)));
    }
  }
}

export async function replaceQueueFile(source, destination, contents, {
  platform = process.platform,
  renameFile = rename,
  wait = sleep,
  writeDestination = writeFile
} = {}) {
  try {
    await renameWithRetry(source, destination, { renameFile, wait, retries: 7 });
  } catch (error) {
    // OneDrive/antivirus may hold an existing destination without delete
    // sharing. The queue's cross-process lock makes an in-place Windows write
    // safe from competing FULE workers, while the temp file remains available
    // until the write has completed.
    if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
    await writeDestination(destination, contents, { mode: 0o600 });
  }
}

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
  const timeoutMs = Math.max(1_000, Number(process.env.DEMO_QUEUE_LOCK_TIMEOUT_MS) || 60_000);
  const deadline = Date.now() + timeoutMs;
  let handle;
  let lastOwner = '';
  let lastLockAgeMs = 0;
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(token);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const [metadata, owner] = await Promise.all([stat(lockPath), readFile(lockPath, 'utf8')]);
        lastOwner = owner;
        lastLockAgeMs = Math.max(0, Date.now() - metadata.mtimeMs);
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw lockError;
      }
      await removeStaleLock();
      if (Date.now() >= deadline) {
        const ownerPid = Number.parseInt(lastOwner.split(':', 1)[0], 10);
        const ownerDetail = Number.isSafeInteger(ownerPid) ? ` Owner PID ${ownerPid}; lock age ${Math.ceil(lastLockAgeMs / 1000)}s.` : '';
        throw new Error(`Timed out after ${timeoutMs}ms waiting for the demo job queue lock.${ownerDetail} Stop duplicate FULE dev servers if that PID is an old instance.`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
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
  const task = writes.catch(() => {}).then(() => withFileLock(async () => {
    const jobs = readJobs();
    const result = operation(jobs);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const contents = `${JSON.stringify(jobs)}\n`;
    try {
      await writeFile(temporary, contents, { mode: 0o600 });
      await replaceQueueFile(temporary, path, contents);
      return result;
    } finally {
      try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') reportQueueError(error); }
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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)), 'demo-jobs.json');
let polling;
let handlers;
let writes = Promise.resolve();

function readJobs() {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return [];
  try { const value = JSON.parse(readFileSync(path, 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; }
}
function update(operation) {
  writes = writes.then(() => {
    const jobs = readJobs();
    const result = operation(jobs);
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(jobs)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    return result;
  });
  return writes;
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
    void update((jobs) => { for (const job of jobs) if (job.state === 'active') job.state = 'waiting'; });
    polling ||= setInterval(() => { void this.processDue(); }, 250);
    polling.unref?.();
    void this.processDue();
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

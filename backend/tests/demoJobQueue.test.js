import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('offline demo queue reloads persisted timers after worker module restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fule-demo-jobs-'));
  const priorDirectory = process.env.FULE_DATA_DIR;
  const priorDemo = process.env.DEMO_MODE;
  process.env.FULE_DATA_DIR = directory;
  process.env.DEMO_MODE = 'true';
  const { demoJobQueue: firstWorker } = await import(`../services/demoJobQueue.js?first=${Date.now()}`);
  try {
    await firstWorker.add('timeout', 'walk-1:timeout:4', { walkId: 'walk-1', checkinNumber: 4 }, -1);
    firstWorker.stop();
    const { demoJobQueue: restartedWorker } = await import(`../services/demoJobQueue.js?restart=${Date.now()}`);
    let invoked = null;
    restartedWorker.start({ timeout: async (walkId, checkinNumber) => { invoked = { walkId, checkinNumber }; } });
    const deadline = Date.now() + 2_000;
    while (!invoked && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30));
    restartedWorker.stop();
    assert.deepEqual(invoked, { walkId: 'walk-1', checkinNumber: 4 });
  } finally {
    firstWorker.stop();
    if (priorDirectory === undefined) delete process.env.FULE_DATA_DIR; else process.env.FULE_DATA_DIR = priorDirectory;
    if (priorDemo === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = priorDemo;
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent demo queue processes use isolated temp files and preserve every scheduled job', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'fule-demo-jobs-race-'));
  const directory = join(temporaryRoot, 'new', 'nested', 'data');
  const moduleUrl = new URL('../services/demoJobQueue.js', import.meta.url).href;
  const ids = Array.from({ length: 6 }, (_, index) => `parallel-walk-${index}:timeout:1`);
  try {
    await Promise.all(ids.map((id, index) => new Promise((resolve, reject) => {
      const code = `const { demoJobQueue } = await import(${JSON.stringify(moduleUrl)}); await demoJobQueue.add('timeout', ${JSON.stringify(id)}, { walkId: ${JSON.stringify(`parallel-walk-${index}`)}, checkinNumber: 1 }, 60000);`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
        env: { ...process.env, DEMO_MODE: 'true', FULE_DATA_DIR: directory },
        stdio: ['ignore', 'ignore', 'pipe']
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('exit', (codeValue) => codeValue === 0 ? resolve() : reject(new Error(`queue writer exited ${codeValue}: ${stderr}`)));
    })));
    const jobs = JSON.parse(await readFile(join(directory, 'demo-jobs.json'), 'utf8'));
    assert.deepEqual(jobs.map((job) => job.id).sort(), [...ids].sort());
    assert.equal((await readdir(directory)).some((name) => name.endsWith('.tmp')), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

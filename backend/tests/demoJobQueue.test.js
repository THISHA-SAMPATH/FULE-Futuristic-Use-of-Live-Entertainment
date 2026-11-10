import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLockOwnerAlive, renameWithRetry, replaceQueueFile } from '../services/demoJobQueue.js';

test('queue lock owner check keeps live owners and recognizes dead owners', () => {
  assert.equal(isLockOwnerAlive(`${process.pid}:live`), true);
  assert.equal(isLockOwnerAlive('not-a-pid:invalid'), false);
  assert.equal(isLockOwnerAlive('54321:dead', { killProcess: () => { const error = new Error('no process'); error.code = 'ESRCH'; throw error; } }), false);
  assert.equal(isLockOwnerAlive('54321:protected', { killProcess: () => { const error = new Error('permission denied'); error.code = 'EPERM'; throw error; } }), true);
});

test('demo queue reclaims an old lock only after its owner process has exited', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'fule-demo-jobs-stale-lock-'));
  const directory = join(temporaryRoot, 'data');
  const moduleUrl = new URL('../services/demoJobQueue.js', import.meta.url).href;
  const lockPath = join(directory, 'demo-jobs.json.lock');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(lockPath, '2147480000:abandoned-lock\n');
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(lockPath, staleTime, staleTime);
    const code = `const { demoJobQueue } = await import(${JSON.stringify(moduleUrl)}); await demoJobQueue.add('timeout', 'recovered:timeout:1', { walkId: 'recovered', checkinNumber: 1 }, 60000);`;
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
        env: { ...process.env, DEMO_MODE: 'true', FULE_DATA_DIR: directory },
        stdio: ['ignore', 'ignore', 'pipe']
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('exit', (codeValue) => codeValue === 0 ? resolve() : reject(new Error(`stale lock recovery exited ${codeValue}: ${stderr}`)));
    });
    const jobs = JSON.parse(await readFile(join(directory, 'demo-jobs.json'), 'utf8'));
    assert.equal(jobs[0].id, 'recovered:timeout:1');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('demo queue retries transient Windows rename locks from file sync clients', async () => {
  let attempts = 0;
  const waits = [];
  await renameWithRetry('pending.json.tmp', 'pending.json', {
    renameFile: async () => {
      attempts += 1;
      if (attempts < 4) { const error = new Error('file temporarily locked'); error.code = 'EPERM'; throw error; }
    },
    wait: async (delay) => { waits.push(delay); },
    initialDelayMs: 10,
    maxDelayMs: 100
  });
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [10, 20, 40]);
});

test('demo queue falls back to a locked in-place write on Windows after rename retries', async () => {
  let renameAttempts = 0;
  let written = null;
  await replaceQueueFile('pending.json.tmp', 'pending.json', '[{"id":"kept"}]\n', {
    platform: 'win32',
    wait: async () => {},
    renameFile: async () => { renameAttempts += 1; const error = new Error('sync client holds destination'); error.code = 'EPERM'; throw error; },
    writeDestination: async (destination, contents, options) => { written = { destination, contents, options }; }
  });
  assert.equal(renameAttempts, 8);
  assert.equal(written.destination, 'pending.json');
  assert.equal(written.contents, '[{"id":"kept"}]\n');
  assert.equal(written.options.mode, 0o600);
});

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

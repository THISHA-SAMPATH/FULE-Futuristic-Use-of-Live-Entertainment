import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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

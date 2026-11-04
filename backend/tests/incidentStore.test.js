import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('incidents and state changes survive a new backend process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fule-sqlite-'));
  const storeUrl = new URL('../services/incidentStore.js', import.meta.url).href;
  const env = { ...process.env, FULE_DATA_DIR: directory };
  const incident = { incident_id: 'persisted-1', created_at: new Date().toISOString(), status: 'PENDING_DISPATCH', streamer_id: 'private-streamer', location: { lat: 1.2, lng: 3.4 } };
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `const store = await import(${JSON.stringify(storeUrl)}); store.persistIncident(${JSON.stringify(incident)}); store.closeIncidentStore();`], { env, stdio: 'ignore' });
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `const store = await import(${JSON.stringify(storeUrl)}); const incident = store.loadIncidents()[0]; store.persistIncident({...incident, status:'ACKNOWLEDGED', acknowledged_by:'guardian-1'}); store.closeIncidentStore();`], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(output, '');
    const persisted = execFileSync(process.execPath, ['--input-type=module', '-e', `const store = await import(${JSON.stringify(storeUrl)}); console.log(JSON.stringify(store.loadIncidents())); store.closeIncidentStore();`], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.deepEqual(JSON.parse(persisted), [{ ...incident, status: 'ACKNOWLEDGED', acknowledged_by: 'guardian-1' }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

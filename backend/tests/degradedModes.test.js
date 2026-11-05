import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDegradedSnapshot } from '../services/degradedModes.js';

test('health snapshot exposes degraded dependencies and confirms guardian alerts remain available', () => {
  const health = buildDegradedSnapshot({ database: 'demo_file', redis: 'disabled', triage: 'available:rules', dispatch: 'simulated' });
  assert.equal(health.mode, 'degraded'); assert.equal(health.alerts_available, true);
  assert.deepEqual(health.degraded_modes, ['database_demo_file_storage', 'redis_disabled_single_instance_only', 'transparent_local_triage', 'dispatch_simulated']);
});

test('database and queue failures are visible without disabling immediate guardian alerts', () => {
  const health = buildDegradedSnapshot({ database: 'degraded', redis: 'degraded', triage: 'available:rules', dispatch: 'available' });
  assert.equal(health.alerts_available, true);
  assert.deepEqual(health.degraded_modes, ['database_unavailable', 'redis_unavailable', 'transparent_local_triage']);
});

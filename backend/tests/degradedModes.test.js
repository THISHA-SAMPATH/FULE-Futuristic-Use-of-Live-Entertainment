import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDegradedSnapshot } from '../services/degradedModes.js';

test('health snapshot exposes degraded dependencies and confirms guardian alerts remain available', () => {
  const health = buildDegradedSnapshot({ database: 'demo_file', redis: 'disabled', ai: 'circuit_open', twitch: 'unconfigured', dispatch: 'simulated' });
  assert.equal(health.mode, 'degraded'); assert.equal(health.alerts_available, true);
  assert.deepEqual(health.degraded_modes, ['database_demo_file_storage', 'redis_disabled_single_instance_only', 'ai_deterministic_fallback', 'twitch_unavailable', 'dispatch_simulated']);
});

test('database and queue failures are visible without disabling immediate guardian alerts', () => {
  const health = buildDegradedSnapshot({ database: 'degraded', redis: 'degraded', ai: 'circuit_open', twitch: 'circuit_open', dispatch: 'available' });
  assert.equal(health.alerts_available, true);
  assert.deepEqual(health.degraded_modes, ['database_unavailable', 'redis_unavailable', 'ai_deterministic_fallback', 'twitch_unavailable']);
});

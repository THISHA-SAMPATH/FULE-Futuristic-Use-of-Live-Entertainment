import test from 'node:test';
import assert from 'node:assert/strict';
import { deterministicFallback, synthesizeIncident } from '../services/incidentSynthesizer.js';

const input = {
  audio_transcript_snippet: 'Someone is following me, please help now.',
  module_type: 'FULE_PROTECT',
  location: { lat: 12.9716, lng: 77.5946 }
};

test('deterministic fallback returns required shape and at most 15 words', () => {
  const result = deterministicFallback(input);
  assert.deepEqual(Object.keys(result), ['threat_level', 'summary', 'recommended_action']);
  assert.equal(result.threat_level, 'CRITICAL');
  assert.ok(result.summary.split(/\s+/).length <= 15);
  assert.equal(typeof result.recommended_action, 'string');
});

test('DEMO_MODE uses deterministic fallback without calling OpenAI', async () => {
  let called = false;
  const client = { responses: { create: async () => { called = true; throw new Error('must not call in demo'); } } };
  const result = await synthesizeIncident(input, { demoMode: true, client });
  assert.equal(called, false);
  assert.deepEqual(result, deterministicFallback(input));
});

test('OpenAI errors fall back deterministically with the same shape', async () => {
  const client = { responses: { create: async () => { throw new Error('offline'); } } };
  const result = await synthesizeIncident(input, { demoMode: false, client });
  assert.deepEqual(result, deterministicFallback(input));
});

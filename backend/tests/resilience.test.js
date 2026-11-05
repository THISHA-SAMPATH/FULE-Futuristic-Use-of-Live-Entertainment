import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitOpenError, withRetriesAndCircuit } from '../services/resilience.js';

test('shared retry helper retries flaky dependencies with exponential jitter and per-call timeout', async () => {
  let calls = 0; const delays = [];
  const result = await withRetriesAndCircuit(async ({ signal, timeoutMs }) => {
    calls += 1; assert.ok(signal instanceof AbortSignal); assert.ok(timeoutMs > 0);
    if (calls < 3) throw new Error('temporary failure');
    return 'ok';
  }, { name: 'fake', timeoutMs: 200, maxAttempts: 3, baseDelayMs: 10, random: () => 0, sleepImpl: async (ms) => delays.push(ms) });
  assert.equal(result, 'ok'); assert.equal(calls, 3); assert.deepEqual(delays, [5, 10]);
});

test('circuit opens after consecutive failed calls and allows one half-open probe', async () => {
  let now = 0; const breaker = new CircuitBreaker({ name: 'fake', failureThreshold: 2, openMs: 50, now: () => now });
  for (let i = 0; i < 2; i += 1) await assert.rejects(withRetriesAndCircuit(async () => { throw new Error('offline'); }, { maxAttempts: 1, circuitBreaker: breaker }));
  await assert.rejects(withRetriesAndCircuit(async () => 'not reached', { circuitBreaker: breaker }), CircuitOpenError);
  now = 51;
  assert.equal(await withRetriesAndCircuit(async () => 'recovered', { circuitBreaker: breaker }), 'recovered');
  assert.equal(breaker.snapshot().state, 'closed');
});

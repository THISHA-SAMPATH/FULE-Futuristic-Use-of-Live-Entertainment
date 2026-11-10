import test from 'node:test';
import assert from 'node:assert/strict';
import { createEscalationLadder } from '../services/escalationLadder.js';

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (callback, delay) => { const key = ++id; timers.set(key, { callback, at: now + delay }); return key; },
    clearTimer: (key) => timers.delete(key),
    advance: async (ms) => { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.callback(); } await new Promise((resolve) => setImmediate(resolve)); }
  };
}

test('escalation ladder alerts guardians at zero, trusted contacts at 30s, dispatch at 60s', async () => {
  const clock = fakeClock();
  const calls = [];
  const incident = { status: 'PENDING_DISPATCH', threat_level: 'ELEVATED', created_at: new Date(0).toISOString(), contacts_notified_at: null };
  createEscalationLadder({ incident, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, isAcknowledged: () => false, isCancelled: () => false, isDispatchSent: () => false, onContacts: () => calls.push('contacts'), onDispatch: () => calls.push('dispatch'), contactsDelayMs: 30_000, dispatchDelayMs: 60_000 });
  await clock.advance(29_999); assert.deepEqual(calls, []);
  await clock.advance(1); assert.deepEqual(calls, ['contacts']);
  await clock.advance(30_000); assert.deepEqual(calls, ['contacts', 'dispatch']);
});

test('guardian acknowledgement cancels both delayed escalation steps', async () => {
  const clock = fakeClock(); let acknowledged = false; const calls = [];
  const ladder = createEscalationLadder({ incident: { status: 'PENDING_DISPATCH', threat_level: 'ELEVATED', created_at: new Date(0).toISOString() }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, isAcknowledged: () => acknowledged, isCancelled: () => false, isDispatchSent: () => false, onContacts: () => calls.push('contacts'), onDispatch: () => calls.push('dispatch') });
  acknowledged = true; ladder.cancel(); await clock.advance(60_000); assert.deepEqual(calls, []);
});

test('CRITICAL incidents dispatch immediately without waiting for the 60 second threshold', async () => {
  const clock = fakeClock(); const calls = [];
  createEscalationLadder({ incident: { status: 'PENDING_DISPATCH', threat_level: 'CRITICAL', created_at: new Date(0).toISOString() }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, isAcknowledged: () => false, isCancelled: () => false, isDispatchSent: () => false, onContacts: () => calls.push('contacts'), onDispatch: () => calls.push('dispatch') });
  await clock.advance(0); assert.deepEqual(calls, ['dispatch']);
});

test('button-policy CRITICAL dispatch waits through its cancel grace window', async () => {
  const clock = fakeClock(); const calls = [];
  const ladder = createEscalationLadder({ incident: { status: 'PENDING_DISPATCH', threat_level: 'CRITICAL', created_at: new Date(0).toISOString() }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, isAcknowledged: () => false, isCancelled: () => false, isDispatchSent: () => false, onContacts: () => calls.push('contacts'), onDispatch: () => calls.push('dispatch'), criticalDispatchDelayMs: 10_000 });
  await clock.advance(9_999); assert.deepEqual(calls, []);
  ladder.cancel(); await clock.advance(1); assert.deepEqual(calls, []);
});

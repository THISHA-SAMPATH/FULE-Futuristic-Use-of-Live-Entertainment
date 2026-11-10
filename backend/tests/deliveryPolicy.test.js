import test from 'node:test';
import assert from 'node:assert/strict';
import { applyButtonTriggerFloor, createDeliveryPlan } from '../services/deliveryPolicy.js';

test('active button SOS never falls below CRITICAL; cancelling releases the floor', () => {
  for (const level of ['LOW', 'ELEVATED', 'CRITICAL']) {
    assert.equal(applyButtonTriggerFloor({ source: 'button', threat_level: level }), 'CRITICAL');
  }
  assert.equal(applyButtonTriggerFloor({ source: 'button', threat_level: 'LOW', status: 'CANCELLED' }), 'LOW');
  assert.equal(applyButtonTriggerFloor({ source: 'chat', threat_level: 'LOW' }), 'LOW');
});

test('tiered delivery is disabled by default and opt-in routes by severity', () => {
  assert.deepEqual(createDeliveryPlan({ threat_level: 'ELEVATED' }), {
    route: 'standard', notify_guardians: true, notify_trusted_circle_now: false, schedule_escalation: true
  });
  assert.deepEqual(createDeliveryPlan({ threat_level: 'CRITICAL', tieredEnabled: true }), {
    route: 'critical_guardian_interrupt', notify_guardians: true, notify_trusted_circle_now: false, schedule_escalation: true
  });
  assert.deepEqual(createDeliveryPlan({ threat_level: 'ELEVATED', tieredEnabled: true }), {
    route: 'trusted_circle_checkin', notify_guardians: false, notify_trusted_circle_now: true, schedule_escalation: true
  });
  assert.deepEqual(createDeliveryPlan({ threat_level: 'LOW', tieredEnabled: true }), {
    route: 'log_only', notify_guardians: false, notify_trusted_circle_now: false, schedule_escalation: false
  });
});

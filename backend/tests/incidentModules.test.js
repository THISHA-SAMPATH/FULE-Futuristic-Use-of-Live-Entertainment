import test from 'node:test';
import assert from 'node:assert/strict';
import { INCIDENT_MODULES, createIncident, isIncident } from '../../shared/incident.mjs';

test('shared incident schema accepts every supported module', () => {
  for (const module of INCIDENT_MODULES) {
    const incident = createIncident({ module, location: { lat: 1, lng: 2 } });
    assert.equal(isIncident(incident), true, `${module} should validate`);
  }
});

test('shared incident schema rejects an unsupported module', () => {
  const incident = createIncident({ location: { lat: 1, lng: 2 } });
  assert.equal(isIncident({ ...incident, module: 'NOT_A_FULE_MODULE' }), false);
});

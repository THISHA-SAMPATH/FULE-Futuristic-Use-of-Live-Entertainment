import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmergencyReport, createDispatchProvider, SimulatedDispatch } from '../services/dispatchBridge.js';

const incident = {
  incident_id: 'incident-1', threat_level: 'CRITICAL', location: { lat: 12.34567, lng: 77.12345, address: 'Transit zone' },
  summary: 'Immediate distress signal registered.', transcript_snippet: 'Please help.',
  stream_url: null, created_at: '2026-11-04T12:00:00.000Z', acknowledged_at: null
};

test('simulation report carries private location and response context internally', () => {
  const report = createEmergencyReport(incident, { streamerContact: { display_name: 'Demo' }, guardianResponses: [{ guardian_id: 'g1', action: 'ACKNOWLEDGED' }] });
  assert.deepEqual(report.location, incident.location);
  assert.equal(report.transcript_snippet, incident.transcript_snippet);
  assert.equal(report.streamer_contact.display_name, 'Demo');
  assert.equal(report.guardian_responses.length, 1);
});

test('dispatch provider is always clearly simulated and never invokes external services', async () => {
  const provider = createDispatchProvider();
  assert.ok(provider instanceof SimulatedDispatch);
  const record = await provider.dispatch(createEmergencyReport(incident));
  assert.equal(record.status, 'SENT');
  assert.equal(record.responder_eta_minutes, 7);
  assert.equal(record.simulated, true);
});

test('simulated dispatch supports stand down and status updates', async () => {
  const provider = new SimulatedDispatch();
  const record = await provider.dispatch(createEmergencyReport(incident));
  assert.equal((await provider.update(record, 'ACCEPTED')).status, 'ACKNOWLEDGED');
  assert.equal((await provider.standDown(record, 'Resolved by user')).stage, 'STAND_DOWN');
});

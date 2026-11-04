import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createEmergencyReport, SimulatedDispatch, WebhookDispatch } from '../services/dispatchBridge.js';

const incident = {
  incident_id: 'incident-1', threat_level: 'CRITICAL', location: { lat: 12.34567, lng: 77.12345, address: 'Transit zone' },
  summary: 'Immediate distress signal registered.', transcript_snippet: 'Please help.', clip_url: 'https://clips.twitch.tv/example',
  stream_url: 'https://www.twitch.tv/example', created_at: '2026-11-04T12:00:00.000Z', acknowledged_at: null
};

test('emergency report includes the exact coordinates and response context for dispatch only', () => {
  const report = createEmergencyReport(incident, { streamerContact: { display_name: 'Demo' }, guardianResponses: [{ guardian_id: 'g1', action: 'ACKNOWLEDGED' }] });
  assert.deepEqual(report.location, incident.location);
  assert.equal(report.transcript_snippet, incident.transcript_snippet);
  assert.equal(report.live_stream_url, incident.stream_url);
  assert.equal(report.streamer_contact.display_name, 'Demo');
  assert.equal(report.guardian_responses.length, 1);
});

test('simulated dispatch returns SENT with an ETA and never needs a real dispatch number', async () => {
  const provider = new SimulatedDispatch({ etaMinutes: 6 });
  const record = await provider.dispatch(createEmergencyReport(incident));
  assert.equal(record.status, 'SENT');
  assert.equal(record.responder_eta_minutes, 6);
  assert.equal(record.simulated, true);
});

test('webhook signs the exact request bytes and retries transient failures', async () => {
  const seen = [];
  const provider = new WebhookDispatch({ url: 'https://dispatch.example/hook', secret: 'test-signing-secret', retries: 2, retryDelayMs: 0, fetchImpl: async (_url, options) => {
    seen.push(options);
    return new Response(JSON.stringify({ dispatch_id: 'external-1', responder_eta_minutes: 9 }), { status: seen.length === 1 ? 503 : 200, headers: { 'content-type': 'application/json' } });
  } });
  const record = await provider.dispatch(createEmergencyReport(incident));
  assert.equal(seen.length, 2);
  const signature = `sha256=${createHmac('sha256', 'test-signing-secret').update(seen[1].body).digest('hex')}`;
  assert.equal(seen[1].headers['x-fule-signature'], signature);
  assert.equal(record.dispatch_id, 'external-1');
  assert.equal(record.status, 'SENT');
});

test('webhook fails after the configured retry budget', async () => {
  let count = 0;
  const provider = new WebhookDispatch({ url: 'https://dispatch.example/hook', secret: 'secret', retries: 1, retryDelayMs: 0, fetchImpl: async () => { count += 1; return new Response('', { status: 502 }); } });
  await assert.rejects(provider.dispatch(createEmergencyReport(incident)), /HTTP 502/);
  assert.equal(count, 2);
});

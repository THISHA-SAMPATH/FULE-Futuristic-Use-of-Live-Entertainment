import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleBasedTriage, provisionalTriage, scoreIncident, setTriageEngine, runTriage } from '../services/triageEngine.js';

const scenarios = [
  { label: 'explicit assault', text: 'Someone is attacking me and has a knife.', hour: 14, risk: 'standard', expected: 'CRITICAL' },
  { label: 'followed after dark', text: 'I am alone and someone is following me.', hour: 23, risk: 'standard', expected: 'CRITICAL' },
  { label: 'harassment on transit', text: 'I am being harassed on the train and feel unsafe.', hour: 18, risk: 'standard', expected: 'CRITICAL' },
  { label: 'alone at night', text: 'Walking alone at night; please stay with me.', hour: 23, risk: 'standard', expected: 'ELEVATED' },
  { label: 'routine safe check', text: 'I am at home and safe, just checking in.', hour: 14, risk: 'standard', expected: 'ELEVATED' },
  { label: 'low risk prompt', text: 'Please check that I arrived safely.', hour: 14, risk: 'standard', expected: 'ELEVATED' },
  { label: 'high user-set risk', text: 'Waiting outside after my shift.', hour: 14, risk: 'high', expected: 'CRITICAL' },
  { label: 'silent SOS', text: '', hour: 14, risk: 'standard', expected: 'CRITICAL' },
  { label: 'lost with support request', text: 'I feel lost and need someone to stay on the phone.', hour: 14, risk: 'standard', expected: 'ELEVATED' },
  { label: 'concerned, daylight', text: 'I feel uncomfortable and would like someone nearby.', hour: 13, risk: 'standard', expected: 'ELEVATED' }
];

test('rule-based triage matches the labeled safety scenario set', () => {
  const triage = createRuleBasedTriage();
  const results = scenarios.map((scenario) => triage.analyze({
    audio_transcript_snippet: scenario.text,
    source: 'button',
    local_hour: scenario.hour,
    risk_level: scenario.risk
  }));
  const correct = results.filter((result, index) => result.threat_level === scenarios[index].expected).length;
  assert.equal(correct, 10);
  assert.equal(correct / scenarios.length, 1);
  for (const result of results) {
    assert.ok(['LOW', 'ELEVATED', 'CRITICAL'].includes(result.threat_level));
    assert.ok(result.summary.split(/\s+/).length <= 15);
    assert.equal(typeof result.recommended_action, 'string');
  }
});

test('scoring accounts for silence, nighttime and user-selected risk', () => {
  const base = { audio_transcript_snippet: 'I need someone nearby.', source: 'button', local_hour: 14, risk_level: 'standard' };
  assert.ok(scoreIncident({ ...base, local_hour: 23 }).score > scoreIncident(base).score);
  assert.ok(scoreIncident({ ...base, risk_level: 'high' }).score > scoreIncident(base).score);
  assert.ok(scoreIncident({ ...base, audio_transcript_snippet: '' }).score > scoreIncident(base).score);
});

test('generalized violence language and duress/check-in source context raise triage without phrase-specific rules', () => {
  const triage = createRuleBasedTriage();
  for (const text of ['Someone is hurting me right now.', 'I was assaulted near the station.', 'An attacker is outside.', 'I cannot leave this room.']) {
    assert.equal(triage.analyze({ audio_transcript_snippet: text, source: 'button', local_hour: 12 }).threat_level, 'CRITICAL', text);
  }
  assert.equal(triage.analyze({ audio_transcript_snippet: '', source: 'duress_pin', local_hour: 12, risk_level: 'elevated' }).threat_level, 'CRITICAL');
  assert.equal(triage.analyze({ audio_transcript_snippet: '', source: 'safe_walk_timeout', local_hour: 12 }).threat_level, 'ELEVATED');
});

test('triage can be replaced behind the engine interface', async () => {
  const custom = { name: 'test-local-model', analyze: () => ({ threat_level: 'LOW', summary: 'local model', recommended_action: 'CHECK_IN' }) };
  setTriageEngine(custom);
  assert.deepEqual(await runTriage({}), { threat_level: 'LOW', summary: 'local model', recommended_action: 'CHECK_IN' });
  setTriageEngine(createRuleBasedTriage());
});

test('deterministic interface returns a compact structured result', () => {
  const result = provisionalTriage({ audio_transcript_snippet: 'Help, someone is following me.', source: 'button', local_hour: 12 });
  assert.equal(result.threat_level, 'CRITICAL');
  assert.equal(result.recommended_action, 'ALERT_GUARDIANS_AND_CALL_112');
  assert.ok(result.signals.length > 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHoldoutDocument, verifyHoldoutGitFreeze } from './holdoutValidation.mjs';

const placeholder = {
  dataset_id: 'holdout_v2', schema_version: '1.0.0', holdout: true, placeholder: true,
  note: 'PLACEHOLDER — user-supplied scenarios go here.', scenario_count: 0, scenarios: []
};
const populated = {
  dataset_id: 'holdout_v2', schema_version: '1.0.0', holdout: true, placeholder: false,
  note: 'User-authored frozen evaluation cases.', scenario_count: 1,
  scenarios: [{ scenario_id: 'case-001', category: 'synthetic', input: { audio_transcript_snippet: '', source: 'button', local_hour: 12, risk_level: 'standard' }, expected_threat_level: 'CRITICAL' }]
};

test('holdout schema accepts the marked placeholder and a valid populated document', () => {
  assert.deepEqual(validateHoldoutDocument(placeholder), { valid: true, errors: [] });
  assert.deepEqual(validateHoldoutDocument(populated), { valid: true, errors: [] });
});

test('holdout schema rejects duplicates, unknown inputs, and inconsistent counts', () => {
  const invalid = structuredClone(populated);
  invalid.scenario_count = 3;
  invalid.scenarios.push({ ...invalid.scenarios[0], input: { ...invalid.scenarios[0].input, location: { lat: 1, lng: 2 } } });
  const result = validateHoldoutDocument(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('scenario_count')));
  assert.ok(result.errors.some((error) => error.includes('scenario_id')));
  assert.ok(result.errors.some((error) => error.includes('location')));
});

function gitStub({ history = ['commit-a'], committed = Buffer.from(JSON.stringify(populated)), initial = 'commit-a' } = {}) {
  return (_command, args) => {
    if (args.includes('--diff-filter=A')) return `${initial}\n`;
    if (args[0] === 'log') return history.join('\n');
    if (args[0] === 'show') return committed;
    throw new Error(`Unexpected Git command ${args.join(' ')}`);
  };
}

test('freeze guard allows an untracked placeholder, but blocks untracked populated holdout data', () => {
  const filePath = 'unused-test-path';
  assert.equal(verifyHoldoutGitFreeze({ document: placeholder, filePath, cwd: '.', gitExec: gitStub({ initial: '', history: [] }), readFile: () => Buffer.from('') }).tracked, false);
  assert.throws(() => verifyHoldoutGitFreeze({ document: populated, filePath, cwd: '.', gitExec: gitStub({ initial: '', history: [] }), readFile: () => Buffer.from('') }), /first Git inclusion/);
});

test('freeze guard permits only the exact first-committed holdout and rejects later history or working edits', () => {
  const filePath = 'unused-test-path';
  const committed = Buffer.from(JSON.stringify(populated));
  assert.equal(verifyHoldoutGitFreeze({ document: populated, filePath, cwd: '.', gitExec: gitStub({ committed }), readFile: () => committed }).immutable, true);
  assert.throws(() => verifyHoldoutGitFreeze({ document: populated, filePath, cwd: '.', gitExec: gitStub({ committed, history: ['commit-b', 'commit-a'] }), readFile: () => committed }), /history shows a change/);
  assert.throws(() => verifyHoldoutGitFreeze({ document: populated, filePath, cwd: '.', gitExec: gitStub({ committed }), readFile: () => Buffer.from('changed') }), /working file differs/);
});

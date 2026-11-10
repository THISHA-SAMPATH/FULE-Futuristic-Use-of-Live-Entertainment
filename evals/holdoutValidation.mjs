import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const THREAT_LEVELS = ['LOW', 'ELEVATED', 'CRITICAL'];
const SOURCES = ['button', 'shake', 'keyboard', 'chat', 'redeem', 'duress_pin', 'safe_walk_timeout', 'safe_walk_duress'];
const RISK_LEVELS = ['standard', 'elevated', 'high'];

export function validateHoldoutDocument(document) {
  const errors = [];
  const issue = (path, message) => errors.push(`${path}: ${message}`);
  if (!document || typeof document !== 'object' || Array.isArray(document)) return { valid: false, errors: ['$: expected an object'] };
  if (document.dataset_id !== 'holdout_v2') issue('dataset_id', 'must equal holdout_v2');
  if (document.schema_version !== '1.0.0') issue('schema_version', 'must equal 1.0.0');
  if (document.holdout !== true) issue('holdout', 'must be true');
  if (typeof document.placeholder !== 'boolean') issue('placeholder', 'must be boolean');
  if (!Number.isInteger(document.scenario_count) || document.scenario_count < 0 || document.scenario_count > 10_000) issue('scenario_count', 'must be an integer from 0 to 10000');
  if (!Array.isArray(document.scenarios) || document.scenarios.length > 10_000) issue('scenarios', 'must be an array with at most 10000 entries');
  if (typeof document.note !== 'string' || document.note.length > 500) issue('note', 'must be a string of at most 500 characters');
  if (!Array.isArray(document.scenarios)) return { valid: false, errors };
  if (document.scenario_count !== document.scenarios.length) issue('scenario_count', 'must equal scenarios.length');
  if (document.placeholder === true && document.scenarios.length !== 0) issue('scenarios', 'placeholder datasets must contain no scenarios');
  if (document.placeholder === true && !document.note?.startsWith('PLACEHOLDER')) issue('note', 'placeholder must be explicitly marked');
  if (document.placeholder === false && document.scenarios.length === 0) issue('scenarios', 'a populated holdout must contain at least one scenario');

  const ids = new Set();
  for (const [index, scenario] of document.scenarios.entries()) {
    const path = `scenarios[${index}]`;
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) { issue(path, 'must be an object'); continue; }
    if (typeof scenario.scenario_id !== 'string' || !scenario.scenario_id.trim() || scenario.scenario_id.length > 100) issue(`${path}.scenario_id`, 'must be a non-empty string of at most 100 characters');
    else if (ids.has(scenario.scenario_id)) issue(`${path}.scenario_id`, 'must be unique');
    else ids.add(scenario.scenario_id);
    if (typeof scenario.category !== 'string' || !scenario.category.trim() || scenario.category.length > 80) issue(`${path}.category`, 'must be a non-empty string of at most 80 characters');
    if (!scenario.input || typeof scenario.input !== 'object' || Array.isArray(scenario.input)) issue(`${path}.input`, 'must be an object');
    else {
      const input = scenario.input;
      if (input.audio_transcript_snippet !== undefined && (typeof input.audio_transcript_snippet !== 'string' || Buffer.byteLength(input.audio_transcript_snippet, 'utf8') > 4000)) issue(`${path}.input.audio_transcript_snippet`, 'must be a string of at most 4000 UTF-8 bytes');
      if (input.source !== undefined && !SOURCES.includes(input.source)) issue(`${path}.input.source`, `must be one of ${SOURCES.join(', ')}`);
      if (input.local_hour !== undefined && (!Number.isInteger(input.local_hour) || input.local_hour < 0 || input.local_hour > 23)) issue(`${path}.input.local_hour`, 'must be an integer from 0 to 23');
      if (input.risk_level !== undefined && !RISK_LEVELS.includes(input.risk_level)) issue(`${path}.input.risk_level`, `must be one of ${RISK_LEVELS.join(', ')}`);
      const allowedInputKeys = new Set(['audio_transcript_snippet', 'source', 'local_hour', 'risk_level']);
      for (const key of Object.keys(input)) if (!allowedInputKeys.has(key)) issue(`${path}.input.${key}`, 'is not allowed');
    }
    if (!THREAT_LEVELS.includes(scenario.expected_threat_level)) issue(`${path}.expected_threat_level`, `must be one of ${THREAT_LEVELS.join(', ')}`);
    for (const key of Object.keys(scenario)) if (!['scenario_id', 'category', 'input', 'expected_threat_level'].includes(key)) issue(`${path}.${key}`, 'is not allowed');
  }
  for (const key of Object.keys(document)) if (!['dataset_id', 'schema_version', 'holdout', 'placeholder', 'note', 'scenario_count', 'scenarios'].includes(key)) issue(key, 'is not allowed');
  return { valid: errors.length === 0, errors };
}

export function verifyHoldoutGitFreeze({ document, filePath, relativePath = 'evals/holdout_v2.json', cwd, gitExec = execFileSync, readFile = readFileSync }) {
  const runGit = (args) => gitExec('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let firstAdd;
  try {
    firstAdd = runGit(['log', '--follow', '--diff-filter=A', '--format=%H', '--reverse', 'HEAD', '--', relativePath]).split(/\s+/).filter(Boolean)[0] || null;
  } catch (error) {
    throw new Error(`Unable to verify the holdout Git history: ${error.message}`);
  }
  if (!firstAdd) {
    if (document.placeholder) return { tracked: false, immutable: false, baseline_commit: null };
    throw new Error('holdout_v2 must be populated and committed as its first Git inclusion before it can be evaluated.');
  }

  const history = runGit(['log', '--follow', '--format=%H', 'HEAD', '--', relativePath]).split(/\s+/).filter(Boolean);
  if (history.length !== 1 || history[0] !== firstAdd) throw new Error('Refusing to evaluate holdout_v2: Git history shows a change after its first included commit.');
  const committed = gitExec('git', ['show', `${firstAdd}:${relativePath}`], { cwd, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
  const working = readFile(filePath);
  const digest = (value) => createHash('sha256').update(value).digest('hex');
  if (digest(committed) !== digest(working)) throw new Error('Refusing to evaluate holdout_v2: working file differs from the first committed version.');
  return { tracked: true, immutable: true, baseline_commit: firstAdd };
}

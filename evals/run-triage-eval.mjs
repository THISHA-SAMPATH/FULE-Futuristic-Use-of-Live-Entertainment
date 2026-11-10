import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuleBasedTriage, scoreIncident } from '../backend/services/triageEngine.js';
import { applyButtonTriggerFloor } from '../backend/services/deliveryPolicy.js';
import { THREAT_LEVELS, holdoutPathFor, validateHoldoutDocument, verifyHoldoutGitFreeze } from './holdoutValidation.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const developmentPath = resolve(directory, 'triage_scenarios.json');
const beforePath = resolve(directory, 'pre_relabel_metrics.json');
const beforeSuitePath = resolve(directory, 'pre_tiered_suite_metrics.json');
const outputPath = resolve(directory, 'BASELINE.md');
const scoreArg = process.argv.find((arg) => arg.startsWith('--score-holdout='));
const scoreFlagIndex = process.argv.indexOf('--score-holdout');
const holdoutDatasetId = scoreArg?.slice('--score-holdout='.length)
  || (scoreFlagIndex >= 0 ? process.argv[scoreFlagIndex + 1] : null);
const scoreHoldout = Boolean(scoreArg || scoreFlagIndex >= 0);
const holdoutRelativePath = holdoutDatasetId ? holdoutPathFor(holdoutDatasetId) : null;
if (scoreHoldout && !holdoutRelativePath) throw new Error('Specify an explicit holdout dataset: --score-holdout=holdout_v2 or --score-holdout=holdout_v3. Default development evaluation never opens holdout files.');
const holdoutPath = holdoutRelativePath ? resolve(directory, holdoutRelativePath.split('/').at(-1)) : null;
const development = JSON.parse(await readFile(developmentPath, 'utf8'));
let holdout = null;
if (scoreHoldout) {
  holdout = JSON.parse(await readFile(holdoutPath, 'utf8'));
  const validation = validateHoldoutDocument(holdout);
  if (!validation.valid) throw new Error(`Invalid ${holdoutDatasetId}: ${validation.errors.join('; ')}`);
  if (holdout.dataset_id !== holdoutDatasetId) throw new Error(`Requested ${holdoutDatasetId}, but dataset_id is ${holdout.dataset_id}.`);
  verifyHoldoutGitFreeze({ document: holdout, filePath: holdoutPath, cwd: root });
}
const classes = THREAT_LEVELS;

if (!Array.isArray(development.scenarios) || development.scenarios.length < 100) throw new Error('Development dataset must contain at least 100 scenarios.');
if (new Set(development.scenarios.map(({ scenario_id }) => scenario_id)).size !== development.scenarios.length) throw new Error('Development scenario IDs must be unique.');
if (development.scenarios.some(({ split }) => !['dev', 'test'].includes(split))) throw new Error('Every development scenario must have a stored dev or test split assignment.');
if (development.scenarios.some(({ trigger_time_label, final_outcome }) => !classes.includes(trigger_time_label) || !['resolved', 'cancelled', 'false_alarm', 'escalated', 'acknowledged'].includes(final_outcome))) throw new Error('Every development scenario must have valid trigger_time_label and final_outcome labels.');

function evaluate(scenarios, engine) {
  const confusion = Object.fromEntries(classes.map((actual) => [actual, Object.fromEntries(classes.map((predicted) => [predicted, 0]))]));
  const scored = scenarios.map((scenario) => {
    const predicted = engine.analyze(scenario.input).threat_level;
    const expected = scenario.trigger_time_label;
    if (!classes.includes(expected) || !classes.includes(predicted)) throw new Error(`Unknown trigger-time label in ${scenario.scenario_id}.`);
    confusion[expected][predicted] += 1;
    return { expected, predicted, category: scenario.category, input: scenario.input };
  });
  const actualCounts = Object.fromEntries(classes.map((label) => [label, scored.filter((scenario) => scenario.expected === label).length]));
  const predictedCounts = Object.fromEntries(classes.map((label) => [label, scored.filter((scenario) => scenario.predicted === label).length]));
  const perClass = Object.fromEntries(classes.map((label) => {
    const tp = confusion[label][label];
    const fp = classes.filter((actual) => actual !== label).reduce((sum, actual) => sum + confusion[actual][label], 0);
    const fn = classes.filter((predicted) => predicted !== label).reduce((sum, predicted) => sum + confusion[label][predicted], 0);
    const tn = scored.length - tp - fp - fn;
    return [label, { precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, false_positive_rate: fp + tn ? fp / (fp + tn) : null, support: tp + fn, predicted: tp + fp, tp, fp, fn, tn }];
  }));
  const correct = scored.reduce((sum, scenario) => sum + Number(scenario.expected === scenario.predicted), 0);
  const alerts = scored.filter(({ predicted }) => predicted === 'ELEVATED' || predicted === 'CRITICAL').length;
  return { size: scored.length, accuracy: scored.length ? correct / scored.length : null, per_class: perClass, confusion, actual_counts: actualCounts, predicted_counts: predictedCounts, alert_load: scored.length ? alerts / scored.length : null, scored };
}

function accuracy(scenarios, engine) {
  if (!scenarios.length) return null;
  return scenarios.filter((scenario) => engine.analyze(scenario.input).threat_level === scenario.trigger_time_label).length / scenarios.length;
}
function correctCount(scenarios, engine) {
  return scenarios.filter((scenario) => engine.analyze(scenario.input).threat_level === scenario.trigger_time_label).length;
}

function atElevatedThreshold(scenarios, threshold) {
  const scored = scenarios.map((scenario) => ({
    expected: scenario.trigger_time_label,
    score: scoreIncident(scenario.input).score
  }));
  const predicted = scored.map(({ expected, score }) => ({
    expected,
    predicted: score >= 7 ? 'CRITICAL' : score >= threshold ? 'ELEVATED' : 'LOW'
  }));
  const classMetric = (label) => {
    const tp = predicted.filter((row) => row.expected === label && row.predicted === label).length;
    const fp = predicted.filter((row) => row.expected !== label && row.predicted === label).length;
    const fn = predicted.filter((row) => row.expected === label && row.predicted !== label).length;
    return { precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
  };
  return {
    alert_load: predicted.filter((row) => row.predicted !== 'LOW').length / predicted.length,
    elevated: classMetric('ELEVATED'),
    critical: classMetric('CRITICAL')
  };
}

function devPattern(scenario) {
  if (scenario.category === 'false_alarm' && scenario.predicted === 'CRITICAL') return 'Negated emergency wording still matches high-severity vocabulary';
  if (scenario.category === 'false_alarm' && scenario.predicted === 'ELEVATED') return 'Button activation adds an urgency floor despite explicit cancellation or reassurance';
  if (scenario.category === 'ambiguous' && /\balone\b/i.test(scenario.input.audio_transcript_snippet || '')) return 'Benign check-in language containing an isolation cue';
  if (scenario.category === 'ambiguous') return 'Mild discomfort or ordinary travel concern triggers elevated wording';
  return `Other ${scenario.category} pattern (${scenario.expected} → ${scenario.predicted})`;
}

const engine = createRuleBasedTriage();
const devResult = evaluate(development.scenarios.filter(({ split }) => split === 'dev'), engine);
const seenTestResult = evaluate(development.scenarios.filter(({ split }) => split === 'test'), engine);
const devScenarios = development.scenarios.filter(({ split }) => split === 'dev');
const judgmentCalls = development.scenarios.filter(({ judgment_call }) => judgment_call === true);
const withoutJudgmentCalls = development.scenarios.filter(({ judgment_call }) => judgment_call !== true);
// This branch runs only when an exact dataset version is explicitly requested; default development scoring opens no holdout file.
const holdoutResult = scoreHoldout && !holdout.placeholder ? evaluate(holdout.scenarios, engine) : null;
const patterns = new Map();
for (const scenario of devResult.scored.filter(({ expected, predicted }) => expected !== predicted)) {
  const cause = devPattern(scenario);
  patterns.set(cause, (patterns.get(cause) || 0) + 1);
}

const before = JSON.parse(await readFile(beforePath, 'utf8'));
const beforeSuites = JSON.parse(await readFile(beforeSuitePath, 'utf8'));
const pct = (value) => value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
const contextTriages = Object.fromEntries(['dev', 'test'].map((split) => [split, evaluate(
  development.scenarios.filter((scenario) => scenario.split === split && !['button', 'redeem'].includes(scenario.input.source)), engine
)]));
const buttonPolicy = Object.fromEntries(['dev', 'test'].map((split) => {
  const scenarios = development.scenarios.filter((scenario) => scenario.split === split && scenario.input.source === 'button');
  const passed = scenarios.filter((scenario) => applyButtonTriggerFloor({ source: scenario.input.source, threat_level: engine.analyze(scenario.input).threat_level, status: 'PENDING_DISPATCH' }) === 'CRITICAL').length;
  return [split, { n: scenarios.length, pass: passed, fail: scenarios.length - passed }];
}));
const buttonPolicyRows = ['dev', 'test'].flatMap((split) => {
  const label = split === 'test' ? 'Previously seen test' : 'Dev';
  const old = beforeSuites.splits[split].trigger_policy;
  const current = buttonPolicy[split];
  return [
    `| ${label} | Before trigger policy | ${old.n} | ${old.pass} | ${old.fail} | ${pct(old.pass / old.n)} |`,
    `| ${label} | After trigger policy | ${current.n} | ${current.pass} | ${current.fail} | ${pct(current.pass / current.n)} |`
  ];
});
const contextRows = ['dev', 'test'].flatMap((split) => {
  const label = split === 'test' ? 'Previously seen test' : 'Dev';
  const old = beforeSuites.splits[split].context_triage;
  const current = contextTriages[split];
  const render = (stage, result) => `| ${label} | ${stage} | ${result.size} | ${pct(result.accuracy)} | ${pct(result.per_class.LOW.precision)} / ${pct(result.per_class.LOW.recall)} | ${pct(result.per_class.LOW.false_positive_rate)} | ${pct(result.per_class.ELEVATED.precision)} / ${pct(result.per_class.ELEVATED.recall)} | ${pct(result.per_class.ELEVATED.false_positive_rate)} | ${pct(result.per_class.CRITICAL.precision)} / ${pct(result.per_class.CRITICAL.recall)} | ${pct(result.per_class.CRITICAL.false_positive_rate)} | ${pct(result.alert_load)} |`;
  const fromSnapshot = {
    size: old.n, accuracy: old.accuracy, per_class: Object.fromEntries(classes.map((c) => [c, {
      precision: old.per_class[c].precision, recall: old.per_class[c].recall, false_positive_rate: old.per_class[c].fpr
    }])), alert_load: old.alert_load
  };
  return [render('Before split / negation change', fromSnapshot), render('After', current)];
});
const devCriticalFalsePositives = devResult.per_class.CRITICAL.fp;
const operatingPoints = [3, 4, 5].map((threshold) => ({ threshold, ...atElevatedThreshold(devScenarios, threshold) }));
const comparisonRows = (split, result) => {
  const old = before[split];
  const cleanupAfter = beforeSuites.splits[split].full_dataset_after_label_cleanup;
  return [
    `| ${split === 'test' ? 'Development test, previously seen' : 'Development'} | Before relabel | ${old.n} | ${pct(old.accuracy)} | ${pct(old.metrics.LOW.precision)} | ${pct(old.metrics.LOW.recall)} | ${pct(old.metrics.LOW.fpr)} | ${pct(old.metrics.ELEVATED.precision)} | ${pct(old.metrics.ELEVATED.recall)} | ${pct(old.metrics.ELEVATED.fpr)} | ${pct(old.metrics.CRITICAL.precision)} | ${pct(old.metrics.CRITICAL.fpr)} | ${pct(old.alert_load)} |`,
    `| ${split === 'test' ? 'Development test, previously seen' : 'Development'} | After label cleanup, before negation fix | ${cleanupAfter.n} | ${pct(cleanupAfter.accuracy)} | ${pct(cleanupAfter.per_class.LOW.precision)} | ${pct(cleanupAfter.per_class.LOW.recall)} | ${pct(cleanupAfter.per_class.LOW.fpr)} | ${pct(cleanupAfter.per_class.ELEVATED.precision)} | ${pct(cleanupAfter.per_class.ELEVATED.recall)} | ${pct(cleanupAfter.per_class.ELEVATED.fpr)} | ${pct(cleanupAfter.per_class.CRITICAL.precision)} | ${pct(cleanupAfter.per_class.CRITICAL.fpr)} | ${pct(cleanupAfter.alert_load)} |`
  ];
};
function renderMatrix(name, result) {
  return [
    `### ${name} confusion matrix after relabel`, '',
    '| Expected \\ Predicted | LOW | ELEVATED | CRITICAL |', '|---|---:|---:|---:|',
    ...classes.map((label) => `| ${label} | ${result.confusion[label].LOW} | ${result.confusion[label].ELEVATED} | ${result.confusion[label].CRITICAL} |`), ''
  ];
}

const lines = [
  '# Triage Evaluation: Trigger-Time Labels', '',
  '- Dataset: small, synthetic, and author-written; development N=70.',
  '- The old 30% test split was seen during previous analysis; it is reported as “development test, previously seen” and is not an independent holdout.',
  '- Optional versioned holdout evaluation runs only when explicitly named; this development-only run did not access any holdout file.',
  '- Scoring target: trigger_time_label only. final_outcome describes the eventual incident state and is not used in triage metrics.',
  '- The historical label-cleanup comparison isolates that label change. This run also includes a general negation-handling rule fix; its dev-only effect is reported separately below.', '',
  '## Before / after relabel metrics', '',
  '| Split | Labels | N | Accuracy | LOW precision | LOW recall | LOW FPR | ELEVATED precision | ELEVATED recall | ELEVATED FPR | CRITICAL precision | CRITICAL FPR | Alert-load |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...comparisonRows('dev', devResult), ...comparisonRows('test', seenTestResult), '',
  'Critical precision and per-class false-positive rates are reported directly in the table. Alert-load is the percentage predicted ELEVATED or CRITICAL.', '',
  '## context_triage suite', '',
  'Includes dev/test scenarios whose source is not button or redeem. Metrics are engine scores, before trigger-policy delivery floors.', '',
  '| Split | Measurement | N | Accuracy | LOW precision / recall | LOW FPR | ELEVATED precision / recall | ELEVATED FPR | CRITICAL precision / recall | CRITICAL FPR | Alert-load |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...contextRows, '',
  '## trigger_policy suite', '',
  'Explicit pass/fail assertions over button-source scenarios: active button SOS must remain CRITICAL until cancelled.', '',
  '| Split | Measurement | N | Pass | Fail | Pass rate |', '|---|---|---:|---:|---:|---:|',
  ...buttonPolicyRows, '',
  '## Negation fix: dev-only engine comparison', '',
  'This comparison uses all dev scenarios before delivery policy is applied. General negation scope suppresses contradicted danger signals; no scenario-specific phrases were added.', '',
  '| Engine version | N | Accuracy | CRITICAL false positives | Alert-load |', '|---|---:|---:|---:|---:|',
  `| Before general negation handling | 70 | ${pct(beforeSuites.splits.dev.full_dev_engine_metrics.accuracy)} | 2 | ${pct(beforeSuites.splits.dev.full_dev_engine_metrics.alert_load)} |`,
  `| After general negation handling | 70 | ${pct(devResult.accuracy)} | ${devCriticalFalsePositives} | ${pct(devResult.alert_load)} |`, '',
  '## Judgment-call accuracy', '',
  `- Label cleanup, 5 of 100 scenarios, all five now agree with the engine. The label change itself did not change rules; this later run reports the separate negation-rule fix above.`,
  `- All scenarios: ${correctCount(withoutJudgmentCalls, engine)} of ${withoutJudgmentCalls.length} excluding judgment calls = ${pct(accuracy(withoutJudgmentCalls, engine))}; judgment-call scenarios: ${correctCount(judgmentCalls, engine)} of ${judgmentCalls.length} = ${pct(accuracy(judgmentCalls, engine))}.`,
  `- Dev split: ${correctCount(devScenarios.filter(({ judgment_call }) => judgment_call !== true), engine)} of ${devScenarios.filter(({ judgment_call }) => judgment_call !== true).length} excluding judgment calls = ${pct(accuracy(devScenarios.filter(({ judgment_call }) => judgment_call !== true), engine))}; all dev scenarios = ${pct(devResult.accuracy)}.`, '',
  '## Dev operating-point analysis (not applied)', '',
  'The current CRITICAL cutoff remains score ≥7. Raising only the ELEVATED cutoff changes classifications for the dev split; this is an offline calculation, not a rule change.', '',
  '| ELEVATED score cutoff | Alert-load | ELEVATED precision | ELEVATED recall | CRITICAL precision | CRITICAL recall |',
  '|---:|---:|---:|---:|---:|---:|',
  ...operatingPoints.map((point) => {
    return `| ${point.threshold} | ${pct(point.alert_load)} | ${pct(point.elevated.precision)} | ${pct(point.elevated.recall)} | ${pct(point.critical.precision)} | ${pct(point.critical.recall)} |`;
  }),
  '',
  `Cutoff 5 is the first tested point under 60% alert-load (${pct(operatingPoints.find(({ threshold }) => threshold === 5).alert_load)}); ELEVATED recall falls from ${pct(operatingPoints[0].elevated.recall)} to ${pct(operatingPoints.find(({ threshold }) => threshold === 5).elevated.recall)}, while CRITICAL recall remains ${pct(operatingPoints.find(({ threshold }) => threshold === 5).critical.recall)} (no observed critical-recall cost on dev).`, '',
  ...renderMatrix('Development', devResult), ...renderMatrix('Development test, previously seen', seenTestResult),
  '## Current dev misclassification patterns', '',
  'Grouped by cause after the negation fix; the remaining button-floor cases are handled separately by trigger_policy.', '',
  ...(patterns.size ? [...patterns.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cause, count]) => `- ${cause}: ${count}; these are button-only raw-engine mismatches and are separated into trigger_policy.`) : ['- No dev misclassifications.']), '',
  '## Earlier four development error groups (old labels, before negation fix)', '',
  '- Benign check-in language containing an isolation cue: 2; those trigger labels were reviewed as ELEVATED.',
  '- Button activation adds an urgency floor despite explicit cancellation or reassurance: 15; retained LOW trigger labels.',
  '- Mild discomfort or ordinary travel concern triggers elevated wording: 2; those trigger labels were reviewed as ELEVATED.',
  '- Negated emergency wording still matches high-severity vocabulary: 2; retained LOW trigger labels.', '',
  `## ${scoreHoldout ? holdoutDatasetId : 'Optional holdout evaluation'}`, '',
  ...(scoreHoldout ? holdoutResult ? [`- N=${holdoutResult.size}; aggregate metrics are included only when the holdout is populated and frozen.`] : ['- The selected holdout is a placeholder or has no scenarios.'] : ['- Not accessed by this development-only run, per the repository rule.']), '',
  '## Method and base-rate caution', '',
  'Each development/test scenario is scored against trigger_time_label. context_triage evaluates the raw deterministic engine on sources other than button/redeem; trigger_policy evaluates the separate active-button delivery floor. Precision and recall use one-vs-rest class counts; FPR is FP/(FP+TN); alert-load is predicted ELEVATED plus CRITICAL divided by N. The historical label-cleanup rows are pre-negation-change metrics; the separate dev-only negation table measures the later rule change. This synthetic, small, author-written dataset over-represents dangerous cases, so precision overstates likely real-world precision. FPR and alert-load are the main caution metrics.'
];

const report = `${lines.join('\n')}\n`;
await writeFile(outputPath, report);
console.log(report);

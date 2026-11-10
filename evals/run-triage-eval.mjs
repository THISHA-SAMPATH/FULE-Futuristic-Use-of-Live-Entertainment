import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuleBasedTriage } from '../backend/services/triageEngine.js';
import { THREAT_LEVELS, validateHoldoutDocument, verifyHoldoutGitFreeze } from './holdoutValidation.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..');
const datasetPath = resolve(directory, 'triage_scenarios.json');
const holdoutPath = resolve(directory, 'holdout_v2.json');
const outputPath = resolve(directory, 'BASELINE.md');
const development = JSON.parse(await readFile(datasetPath, 'utf8'));
const holdout = JSON.parse(await readFile(holdoutPath, 'utf8'));
const holdoutValidation = validateHoldoutDocument(holdout);
if (!holdoutValidation.valid) throw new Error(`Invalid holdout_v2: ${holdoutValidation.errors.join('; ')}`);
const holdoutFreeze = verifyHoldoutGitFreeze({ document: holdout, filePath: holdoutPath, cwd: root });
const classes = THREAT_LEVELS;

if (!Array.isArray(development.scenarios) || development.scenarios.length < 100) throw new Error('Development dataset must contain at least 100 scenarios.');
if (new Set(development.scenarios.map(({ scenario_id }) => scenario_id)).size !== development.scenarios.length) throw new Error('Development scenario IDs must be unique.');
if (development.scenarios.some(({ split }) => !['dev', 'test'].includes(split))) throw new Error('Every development scenario must have a stored dev or test split assignment.');

function evaluate(scenarios, engine) {
  const confusion = Object.fromEntries(classes.map((actual) => [actual, Object.fromEntries(classes.map((predicted) => [predicted, 0]))]));
  const scored = scenarios.map((scenario) => {
    const predicted = engine.analyze(scenario.input).threat_level;
    if (!classes.includes(scenario.expected_threat_level) || !classes.includes(predicted)) throw new Error(`Unknown threat label in ${scenario.scenario_id}.`);
    confusion[scenario.expected_threat_level][predicted] += 1;
    return { expected: scenario.expected_threat_level, predicted, category: scenario.category, input: scenario.input };
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
// The immutable holdout is evaluated exactly once in this invocation. An empty placeholder is validated and reported as pending.
const holdoutResult = holdout.placeholder ? null : evaluate(holdout.scenarios, engine);
const devMisclassificationPatterns = new Map();
for (const scenario of devResult.scored.filter(({ expected, predicted }) => expected !== predicted)) {
  const cause = devPattern(scenario);
  devMisclassificationPatterns.set(cause, (devMisclassificationPatterns.get(cause) || 0) + 1);
}

const pct = (value) => value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`;
const renderSplit = (name, result) => {
  if (!result) return [`### ${name}`, '', '- Status: pending; holdout_v2 is a placeholder with no labels yet.', '- N: 0; precision, recall, false-positive rates, alert-load, and confusion matrix: N/A.', ''];
  const criticalPrecision = result.per_class.CRITICAL.precision;
  const lines = [
    `### ${name}`, '',
    `- N: ${result.size}; accuracy: ${pct(result.accuracy)}; critical precision: ${pct(criticalPrecision)}; alert-load (predicted ELEVATED or CRITICAL): ${pct(result.alert_load)}.`,
    `- Expected counts: LOW ${result.actual_counts.LOW}, ELEVATED ${result.actual_counts.ELEVATED}, CRITICAL ${result.actual_counts.CRITICAL}.`,
    `- Predicted counts: LOW ${result.predicted_counts.LOW}, ELEVATED ${result.predicted_counts.ELEVATED}, CRITICAL ${result.predicted_counts.CRITICAL}.`, '',
    '| Class | Precision | Recall | False-positive rate | Support | Predicted | FP | FN |', '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...classes.map((label) => { const metric = result.per_class[label]; return `| ${label} | ${pct(metric.precision)} | ${pct(metric.recall)} | ${pct(metric.false_positive_rate)} | ${metric.support} | ${metric.predicted} | ${metric.fp} | ${metric.fn} |`; }), '',
    'Confusion matrix (rows = expected, columns = predicted):', '',
    '| Expected \\ Predicted | LOW | ELEVATED | CRITICAL |', '|---|---:|---:|---:|',
    ...classes.map((label) => `| ${label} | ${result.confusion[label].LOW} | ${result.confusion[label].ELEVATED} | ${result.confusion[label].CRITICAL} |`), ''
  ];
  return lines;
};

const lines = [
  '# Triage Evaluation Report', '',
  '- The development dataset is small, synthetic, and author-written.',
  '- The original 30% test split was seen during prior analysis; it is labeled “development test, previously seen” and is not a holdout.',
  '- Only holdout_v2 is designated held out. Its score is meaningful as a frozen evaluation only after the populated file is included in its first Git commit; subsequent history or working-copy changes make evaluation fail closed.',
  `- Engine: ${engine.name}. No rules were changed for this evaluation update.`,
  `- Holdout Git status: ${holdoutFreeze.immutable ? `frozen at ${holdoutFreeze.baseline_commit}` : 'not yet committed; placeholder permitted'}.`, '',
  ...renderSplit('Development split', devResult),
  ...renderSplit('Development test, previously seen', seenTestResult),
  ...renderSplit('holdout_v2', holdoutResult),
  '## Remaining development ELEVATED/LOW misclassification patterns', '',
  'Grouped by cause; no rule changes were made. This section includes development examples only.', '',
  ...(devMisclassificationPatterns.size
    ? [...devMisclassificationPatterns.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cause, count]) => `- ${cause}: ${count}`)
    : ['- No development misclassifications.']), '',
  '## Method and limitations', '',
  'Each scenario is evaluated once with the current deterministic rule engine. Precision, recall, and one-vs-rest false-positive rate are calculated per class. Alert-load is the fraction predicted ELEVATED or CRITICAL. The author-written dataset is small and synthetic; only the frozen holdout_v2 may be described as held out, and even it does not establish real-world safety performance.'
];

const report = `${lines.join('\n')}\n`;
await writeFile(outputPath, report);
console.log(report);

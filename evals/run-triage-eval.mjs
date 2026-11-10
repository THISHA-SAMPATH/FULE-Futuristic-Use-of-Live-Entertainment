import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuleBasedTriage } from '../backend/services/triageEngine.js';

const directory = dirname(fileURLToPath(import.meta.url));
const datasetPath = resolve(directory, 'triage_scenarios.json');
const outputPath = resolve(directory, 'BASELINE.md');
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const classes = ['LOW', 'ELEVATED', 'CRITICAL'];
if (!Array.isArray(dataset.scenarios) || dataset.scenarios.length < 100) throw new Error('Evaluation dataset must contain at least 100 scenarios.');
if (new Set(dataset.scenarios.map(({ scenario_id }) => scenario_id)).size !== dataset.scenarios.length) throw new Error('Scenario IDs must be unique.');

const engine = createRuleBasedTriage();
const matrix = Object.fromEntries(classes.map((expected) => [expected, Object.fromEntries(classes.map((predicted) => [predicted, 0]))]));
const predictions = dataset.scenarios.map((scenario) => {
  const actual = scenario.expected_threat_level;
  if (!classes.includes(actual)) throw new Error(`Unknown expected class in ${scenario.scenario_id}: ${actual}`);
  const result = engine.analyze(scenario.input);
  if (!classes.includes(result.threat_level)) throw new Error(`Unknown predicted class in ${scenario.scenario_id}: ${result.threat_level}`);
  matrix[actual][result.threat_level] += 1;
  return { ...scenario, predicted_threat_level: result.threat_level };
});

const perClass = Object.fromEntries(classes.map((label) => {
  const tp = matrix[label][label];
  const fp = classes.filter((actual) => actual !== label).reduce((sum, actual) => sum + matrix[actual][label], 0);
  const fn = classes.filter((predicted) => predicted !== label).reduce((sum, predicted) => sum + matrix[label][predicted], 0);
  return [label, { precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, support: tp + fn, tp, fp, fn }];
}));
const correct = predictions.filter(({ expected_threat_level, predicted_threat_level }) => expected_threat_level === predicted_threat_level).length;
const falseNegatives = predictions.filter(({ expected_threat_level, predicted_threat_level }) => classes.indexOf(predicted_threat_level) < classes.indexOf(expected_threat_level));
const pct = (number) => `${(number * 100).toFixed(1)}%`;
const lines = [
  '# Rule Triage Baseline', '',
  `- Dataset version: ${dataset.dataset_version}`,
  `- Dataset size: ${predictions.length} synthetic scenarios`,
  `- Engine: ${engine.name}`,
  '- Method: one pass per scenario using createRuleBasedTriage().analyze(input); expected labels are hand-authored in the versioned synthetic dataset. No training or tuning was performed during evaluation.',
  `- Accuracy: ${correct}/${predictions.length} (${pct(correct / predictions.length)})`, '',
  '## Per-class metrics', '',
  '| Threat level | Precision | Recall | Support | TP | FP | FN |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...classes.map((label) => { const m = perClass[label]; return `| ${label} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.support} | ${m.tp} | ${m.fp} | ${m.fn} |`; }), '',
  '## Confusion matrix', '',
  'Rows are expected labels; columns are predicted labels.', '',
  '| Expected \\ Predicted | LOW | ELEVATED | CRITICAL |',
  '|---|---:|---:|---:|',
  ...classes.map((label) => `| ${label} | ${matrix[label].LOW} | ${matrix[label].ELEVATED} | ${matrix[label].CRITICAL} |`), '',
  `## False negatives (${falseNegatives.length})`, '',
  'False negative means the engine predicted a lower threat level than the scenario label.', '',
  ...(falseNegatives.length ? falseNegatives.map(({ scenario_id, category, expected_threat_level, predicted_threat_level, input }) => `- ${scenario_id} (${category}): expected ${expected_threat_level}, predicted ${predicted_threat_level}; input: ${JSON.stringify(input)}`) : ['- None.']), '',
  '## Interpretation', '',
  'This is a small synthetic diagnostic set, not evidence of real-world safety performance. It measures agreement with authored labels only; it does not establish calibration, robustness, demographic fairness, or suitability for dispatch decisions.'
];
const report = `${lines.join('\n')}\n`;
await writeFile(outputPath, report);
console.log(report);

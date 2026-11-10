import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuleBasedTriage } from '../backend/services/triageEngine.js';

const directory = dirname(fileURLToPath(import.meta.url));
const datasetPath = resolve(directory, 'triage_scenarios.json');
const beforePath = resolve(directory, 'rule_baseline_before.json');
const outputPath = resolve(directory, 'BASELINE.md');
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const classes = ['LOW', 'ELEVATED', 'CRITICAL'];
if (!Array.isArray(dataset.scenarios) || dataset.scenarios.length < 100) throw new Error('Evaluation dataset must contain at least 100 scenarios.');
if (new Set(dataset.scenarios.map(({ scenario_id }) => scenario_id)).size !== dataset.scenarios.length) throw new Error('Scenario IDs must be unique.');
if (dataset.scenarios.some(({ split }) => !['dev', 'test'].includes(split))) throw new Error('Every scenario must have a stored dev or test split assignment.');

function evaluate(scenarios, engine) {
  const confusion = Object.fromEntries(classes.map((actual) => [actual, Object.fromEntries(classes.map((predicted) => [predicted, 0]))]));
  const scored = scenarios.map((scenario) => {
    const predicted = engine.analyze(scenario.input).threat_level;
    if (!classes.includes(scenario.expected_threat_level) || !classes.includes(predicted)) throw new Error(`Unknown threat label in scenario ${scenario.scenario_id}.`);
    confusion[scenario.expected_threat_level][predicted] += 1;
    return { ...scenario, predicted_threat_level: predicted };
  });
  const perClass = Object.fromEntries(classes.map((label) => {
    const tp = confusion[label][label];
    const fp = classes.filter((actual) => actual !== label).reduce((sum, actual) => sum + confusion[actual][label], 0);
    const fn = classes.filter((predicted) => predicted !== label).reduce((sum, predicted) => sum + confusion[label][predicted], 0);
    return [label, { precision: tp + fp ? tp / (tp + fp) : 0, recall: tp + fn ? tp / (tp + fn) : 0, support: tp + fn, tp, fp, fn }];
  }));
  const correct = scored.reduce((sum, scenario) => sum + Number(scenario.expected_threat_level === scenario.predicted_threat_level), 0);
  return {
    size: scored.length,
    accuracy: scored.length ? correct / scored.length : 0,
    per_class: perClass,
    confusion,
    dev_false_negatives: scored.filter((scenario) => scenario.split === 'dev' && classes.indexOf(scenario.predicted_threat_level) < classes.indexOf(scenario.expected_threat_level))
      .map(({ scenario_id, category, expected_threat_level, predicted_threat_level, input }) => ({ scenario_id, category, expected_threat_level, predicted_threat_level, input }))
  };
}

const engine = createRuleBasedTriage();
const current = Object.fromEntries(['dev', 'test'].map((split) => [split, evaluate(dataset.scenarios.filter((scenario) => scenario.split === split), engine)]));
if (process.argv.includes('--capture-before')) {
  const snapshot = { dataset_version: dataset.dataset_version, split: dataset.split, engine: engine.name, evaluated_at: new Date().toISOString(), dev: current.dev, test: { size: current.test.size, accuracy: current.test.accuracy, per_class: current.test.per_class, confusion: current.test.confusion } };
  await writeFile(beforePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Saved pre-change aggregate baseline to ${beforePath}`);
  console.log(`DEV ${current.dev.size}: ${(current.dev.accuracy * 100).toFixed(1)}% accuracy; CRITICAL recall ${(current.dev.per_class.CRITICAL.recall * 100).toFixed(1)}%`);
  console.log(`TEST ${current.test.size}: ${(current.test.accuracy * 100).toFixed(1)}% accuracy; CRITICAL recall ${(current.test.per_class.CRITICAL.recall * 100).toFixed(1)}%`);
  process.exit(0);
}

const before = JSON.parse(await readFile(beforePath, 'utf8'));
if (before.dataset_version !== dataset.dataset_version || before.split?.seed !== dataset.split?.seed) throw new Error('Saved before baseline does not match the current dataset version and split seed.');
const pct = (value) => `${(value * 100).toFixed(1)}%`;
const lines = [
  '# Rule Triage Baseline', '',
  `- Dataset version: ${dataset.dataset_version}; ${dataset.scenario_count} synthetic, author-written scenarios.`,
  `- Split: ${dataset.split.strategy}, seed ${dataset.split.seed}, 70/30 dev/test; assignments are stored per scenario in the dataset file.`,
  '- Method: single deterministic inference per scenario using the current rule engine. No training; the pre-change snapshot was captured before modifying the rules.',
  '- The test split is held out from rule changes. It is reported only as aggregate metrics; no test scenarios or individual test errors are printed.', '',
  '## Before and after', '',
  '| Split | Version | N | Accuracy | LOW precision | LOW recall | ELEVATED precision | ELEVATED recall | CRITICAL precision | CRITICAL recall |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...['dev', 'test'].flatMap((split) => {
    const old = before[split]; const next = current[split];
    return [
      `| ${split} | Before | ${old.size} | ${pct(old.accuracy)} | ${pct(old.per_class.LOW.precision)} | ${pct(old.per_class.LOW.recall)} | ${pct(old.per_class.ELEVATED.precision)} | ${pct(old.per_class.ELEVATED.recall)} | ${pct(old.per_class.CRITICAL.precision)} | ${pct(old.per_class.CRITICAL.recall)} |`,
      `| ${split} | After | ${next.size} | ${pct(next.accuracy)} | ${pct(next.per_class.LOW.precision)} | ${pct(next.per_class.LOW.recall)} | ${pct(next.per_class.ELEVATED.precision)} | ${pct(next.per_class.ELEVATED.recall)} | ${pct(next.per_class.CRITICAL.precision)} | ${pct(next.per_class.CRITICAL.recall)} |`
    ];
  }), '',
  '## Dev confusion matrix after changes', '',
  'Rows are expected labels; columns are predicted labels.', '',
  '| Expected \\ Predicted | LOW | ELEVATED | CRITICAL |', '|---|---:|---:|---:|',
  ...classes.map((label) => `| ${label} | ${current.dev.confusion[label].LOW} | ${current.dev.confusion[label].ELEVATED} | ${current.dev.confusion[label].CRITICAL} |`), '',
  '## Test confusion matrix after changes (aggregate only)', '',
  '| Expected \\ Predicted | LOW | ELEVATED | CRITICAL |', '|---|---:|---:|---:|',
  ...classes.map((label) => `| ${label} | ${current.test.confusion[label].LOW} | ${current.test.confusion[label].ELEVATED} | ${current.test.confusion[label].CRITICAL} |`), '',
  `## Dev false negatives (${current.dev.dev_false_negatives.length})`, '',
  'Listed for development error analysis only. No scenario-level test results are included.', '',
  ...(current.dev.dev_false_negatives.length ? current.dev.dev_false_negatives.map((item) => `- ${item.scenario_id} (${item.category}): expected ${item.expected_threat_level}, predicted ${item.predicted_threat_level}; input ${JSON.stringify(item.input)}`) : ['- None.']), '',
  '## Limitations', '',
  'The dataset is small, synthetic, author-written, and not representative of real incident reports. Scores measure agreement with these labels only; they do not establish real-world safety, calibration, robustness, or fairness.'
];
const report = `${lines.join('\n')}\n`;
await writeFile(outputPath, report);
console.log(report);

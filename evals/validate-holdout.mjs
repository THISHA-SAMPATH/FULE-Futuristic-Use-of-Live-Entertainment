import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { holdoutPathFor, validateHoldoutDocument } from './holdoutValidation.mjs';

const datasetId = process.argv[2];
const relativePath = holdoutPathFor(datasetId);
if (!relativePath) throw new Error('Usage: node evals/validate-holdout.mjs holdout_v2|holdout_v3');
const path = resolve(fileURLToPath(new URL(`./${datasetId}.json`, import.meta.url)));
const document = JSON.parse(await readFile(path, 'utf8'));
const result = validateHoldoutDocument(document);
if (!result.valid) {
  console.error(`Invalid ${datasetId} (${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}):`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(document.placeholder ? `${datasetId} schema valid; placeholder is empty.` : `${datasetId} schema valid; ${document.scenarios.length} scenarios.`);
}

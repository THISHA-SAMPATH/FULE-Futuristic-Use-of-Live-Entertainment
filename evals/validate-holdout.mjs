import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHoldoutDocument } from './holdoutValidation.mjs';

const path = resolve(fileURLToPath(new URL('./holdout_v2.json', import.meta.url)));
const document = JSON.parse(await readFile(path, 'utf8'));
const result = validateHoldoutDocument(document);
if (!result.valid) {
  console.error(`Invalid holdout_v2 (${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}):`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(document.placeholder ? 'holdout_v2 schema valid; placeholder is empty.' : `holdout_v2 schema valid; ${document.scenarios.length} scenarios.`);
}

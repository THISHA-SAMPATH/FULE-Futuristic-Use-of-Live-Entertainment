import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CI fails on verification failures and only deploys main through the configured hook', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  for (const required of ['npm test', 'npm run build', 'npm audit --audit-level=high', "github.ref == 'refs/heads/main'", 'RENDER_DEPLOY_HOOK_URL', 'curl --fail']) assert.ok(workflow.includes(required), `workflow missing ${required}`);
});

test('runbook documents slow alerts and failing SOS checks using exported health and metrics', async () => {
  const runbook = await readFile(new URL('../../RUNBOOK.md', import.meta.url), 'utf8');
  for (const required of ['## Alerts are slow', '## SOS requests failing', '/api/health', '/api/ready', '/metrics', 'fule_alert_delivery_latency_seconds', 'fule_http_request_duration_seconds', 'Retry-After']) assert.ok(runbook.includes(required), `runbook missing ${required}`);
});

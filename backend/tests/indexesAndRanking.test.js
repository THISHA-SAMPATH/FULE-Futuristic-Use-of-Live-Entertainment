import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import knexFactory from 'knex';
import { rankGuardians } from '../services/guardianRanking.js';

test('guardian ranking weights distance, response speed and trust deterministically', () => {
  const ranked = rankGuardians([
    { guardian_id: 'far', distance_m: 300, response_time_seconds: 20, trust_rating: 5 },
    { guardian_id: 'near-fast', distance_m: 80, response_time_seconds: 15, trust_rating: 4 },
    { guardian_id: 'near-trusted', distance_m: 100, response_time_seconds: 40, trust_rating: 5 }
  ]);
  assert.equal(ranked[0].guardian_id, 'near-fast');
  assert.ok(ranked[0].ranking_score > ranked[2].ranking_score);
  assert.deepEqual(ranked.map((item) => item.guardian_id), rankGuardians([...ranked].reverse()).map((item) => item.guardian_id));
});

test('incident migration defines the hot indexes and EXPLAIN validates the migrated query plan when PostgreSQL is configured', async (t) => {
  const migration = await readFile(new URL('../migrations/202611040001_initial.mjs', import.meta.url), 'utf8');
  for (const name of ['incidents_status_idx', 'incidents_created_at_idx', 'incidents_streamer_idx']) assert.ok(migration.includes(name));
  if (!process.env.DATABASE_URL) { t.diagnostic('PostgreSQL is not configured locally; CI runs EXPLAIN after migrations.'); return; }
  const db = knexFactory({ client: 'pg', connection: process.env.DATABASE_URL });
  try {
    const indexes = await db('pg_indexes').select('indexname').where({ tablename: 'incidents' });
    const names = new Set(indexes.map((row) => row.indexname));
    for (const name of ['incidents_status_idx', 'incidents_created_at_idx', 'incidents_streamer_idx']) assert.ok(names.has(name), `missing ${name}`);
    await db.raw('SET enable_seqscan = off');
    const result = await db.raw("EXPLAIN (FORMAT JSON) SELECT incident_id FROM incidents WHERE status = 'PENDING_DISPATCH'");
    assert.ok(Array.isArray(result.rows[0]['QUERY PLAN']));
    assert.match(JSON.stringify(result.rows[0]['QUERY PLAN']), /incidents_status_idx/);
  } finally { await db.destroy(); }
});

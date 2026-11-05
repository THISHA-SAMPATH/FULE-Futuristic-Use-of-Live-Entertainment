export async function up(knex) {
  await knex.schema.alterTable('idempotency_keys', (table) => table.jsonb('response').nullable().alter());
  await knex.schema.createTable('twitch_event_dedup', (table) => {
    table.string('event_id', 180).primary();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.index(['expires_at'], 'twitch_event_dedup_expiry_idx');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('twitch_event_dedup');
  await knex.schema.alterTable('idempotency_keys', (table) => table.jsonb('response').notNullable().alter());
}

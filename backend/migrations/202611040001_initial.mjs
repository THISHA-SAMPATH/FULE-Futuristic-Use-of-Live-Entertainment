export async function up(knex) {
  await knex.schema.createTable('incidents', (table) => {
    table.string('incident_id', 160).primary();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.string('status', 40).notNullable();
    table.string('streamer_id', 160).notNullable().defaultTo('');
    table.jsonb('payload').notNullable();
    table.index(['status'], 'incidents_status_idx');
    table.index(['created_at'], 'incidents_created_at_idx');
    table.index(['streamer_id'], 'incidents_streamer_idx');
    table.index(['streamer_id', 'status'], 'incidents_streamer_status_idx');
  });
  await knex.raw("CREATE UNIQUE INDEX incidents_one_pending_per_streamer_idx ON incidents (streamer_id) WHERE status IN ('PENDING_DISPATCH','DISPATCHING','ESCALATED')");
  await knex.schema.createTable('trusted_contacts', (table) => {
    table.string('streamer_id', 160).primary();
    table.jsonb('contacts').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('false_alarm_counts', (table) => {
    table.string('streamer_id', 160).primary();
    table.integer('count').notNullable().defaultTo(0);
    table.timestamp('updated_at', { useTz: true }).notNullable();
  });
  await knex.schema.createTable('audit_events', (table) => {
    table.bigIncrements('id').primary();
    table.string('event', 100).notNullable();
    table.string('incident_id', 160).nullable();
    table.string('actor_id', 160).nullable();
    table.jsonb('payload').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['incident_id', 'created_at'], 'audit_incident_created_idx');
  });
  await knex.schema.createTable('accounts', (table) => {
    table.string('account_id', 160).primary();
    table.string('email', 320).notNullable().unique();
    table.string('password_hash', 255).nullable();
    table.string('role', 24).notNullable().defaultTo('user');
    table.boolean('guardian_approved').notNullable().defaultTo(false);
    table.integer('auth_version').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('refresh_tokens', (table) => {
    table.string('token_hash', 64).primary();
    table.string('account_id', 160).notNullable().references('account_id').inTable('accounts').onDelete('CASCADE');
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.index(['account_id', 'expires_at'], 'refresh_account_expiry_idx');
  });
  await knex.schema.createTable('idempotency_keys', (table) => {
    table.string('key', 200).primary();
    table.string('streamer_id', 160).notNullable();
    table.string('incident_id', 160).notNullable();
    table.jsonb('response').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('streamer_incident_sessions', (table) => {
    table.string('incident_id', 160).primary().references('incident_id').inTable('incidents').onDelete('CASCADE');
    table.string('streamer_id', 160).notNullable();
    table.string('token_hash', 64).notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.index(['streamer_id', 'expires_at'], 'streamer_session_expiry_idx');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('idempotency_keys');
  await knex.schema.dropTableIfExists('streamer_incident_sessions');
  await knex.schema.dropTableIfExists('accounts');
  await knex.schema.dropTableIfExists('audit_events');
  await knex.schema.dropTableIfExists('false_alarm_counts');
  await knex.schema.dropTableIfExists('trusted_contacts');
  await knex.schema.dropTableIfExists('incidents');
}

export async function up(knex) {
  await knex.schema.createTable('safe_walks', (table) => {
    table.string('walk_id', 160).primary();
    table.string('streamer_id', 160).notNullable();
    table.string('status', 32).notNullable();
    table.jsonb('payload').notNullable();
    table.string('duress_pin_hash', 64).notNullable();
    table.string('safe_pin_hash', 64).notNullable();
    table.string('session_token_hash', 64).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['streamer_id', 'status'], 'safe_walk_streamer_status_idx');
  });
  await knex.schema.createTable('safe_walk_push_subscriptions', (table) => {
    table.string('streamer_id', 160).notNullable();
    table.string('endpoint_hash', 64).notNullable();
    table.jsonb('subscription').notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['streamer_id', 'endpoint_hash']);
    table.index(['streamer_id'], 'safe_walk_push_streamer_idx');
  });
  await knex.schema.createTable('guardian_duty_locations', (table) => {
    table.string('guardian_id', 160).primary();
    table.decimal('lat', 10, 7).notNullable();
    table.decimal('lng', 10, 7).notNullable();
    table.string('area_label', 160).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['updated_at'], 'guardian_duty_updated_idx');
    table.index(['lat', 'lng'], 'guardian_duty_coordinates_idx');
  });
  await knex.schema.createTable('nearby_guardian_offers', (table) => {
    table.string('incident_id', 160).notNullable().references('incident_id').inTable('incidents').onDelete('CASCADE');
    table.string('guardian_id', 160).notNullable();
    table.integer('priority').notNullable();
    table.string('approximate_area', 160).notNullable();
    table.timestamp('offered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('accepted_at', { useTz: true }).nullable();
    table.primary(['incident_id', 'guardian_id']);
    table.index(['incident_id', 'priority'], 'nearby_offer_priority_idx');
    table.index(['guardian_id', 'offered_at'], 'nearby_offer_guardian_idx');
  });
  await knex.schema.createTable('evidence_chain_heads', (table) => {
    table.string('incident_id', 160).primary().references('incident_id').inTable('incidents').onDelete('CASCADE');
    table.integer('last_seq').notNullable().defaultTo(0);
    table.string('last_hash', 64).notNullable().defaultTo('0'.repeat(64));
  });
  await knex.schema.createTable('evidence_chunks', (table) => {
    table.string('chunk_id', 160).primary();
    table.string('incident_id', 160).notNullable().references('incident_id').inTable('incidents').onDelete('CASCADE');
    table.integer('sequence').notNullable();
    table.timestamp('recorded_at', { useTz: true }).notNullable();
    table.string('storage_key', 500).notNullable();
    table.string('sha256', 64).notNullable();
    table.string('previous_hash', 64).notNullable();
    table.string('chain_hash', 64).notNullable();
    table.jsonb('metadata').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.unique(['incident_id', 'sequence'], 'evidence_incident_sequence_unique');
    table.index(['incident_id', 'recorded_at'], 'evidence_incident_time_idx');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('evidence_chunks');
  await knex.schema.dropTableIfExists('evidence_chain_heads');
  await knex.schema.dropTableIfExists('guardian_duty_locations');
  await knex.schema.dropTableIfExists('nearby_guardian_offers');
  await knex.schema.dropTableIfExists('safe_walks');
  await knex.schema.dropTableIfExists('safe_walk_push_subscriptions');
}

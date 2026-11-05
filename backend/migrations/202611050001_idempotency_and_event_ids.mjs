export async function up(knex) {
  await knex.schema.alterTable('idempotency_keys', (table) => table.jsonb('response').nullable().alter());
}

export async function down(knex) {
  await knex.schema.alterTable('idempotency_keys', (table) => table.jsonb('response').notNullable().alter());
}

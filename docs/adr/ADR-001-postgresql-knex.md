# ADR-001: PostgreSQL with Knex migrations

- Status: Accepted
- Date: 2026-11-04

## Decision

Use PostgreSQL as the production source of truth and Knex for explicit migrations and repository access. Keep a file repository for isolated local demo/test runs; require `DATABASE_URL` in production. Preserve the previous local SQLite data through a one-time importer.

## Rationale

PostgreSQL provides durable concurrent writes, indexed incident queries, transactions, and shared state for horizontally scaled API instances. Knex keeps queries and migrations in the existing JavaScript stack while the repository interface keeps adapters replaceable.

## Consequences

Deployments must run and monitor PostgreSQL, manage pooled connections, back up data, and apply migrations before serving traffic. SQLite import is explicit and non-destructive.

# ADR 0004: Explicit sequelize-cli migrations, idempotent-safe against a legacy database

## Status

Accepted (Phase 1).

## Context

The pre-Phase-1 backend called `sequelize.sync({ alter: process.env.NODE_ENV !== 'production' })` on every startup — there was no migration history, and running against a database that already has hand-evolved tables (from repeated `sync()` calls during earlier development) needed to be a first-class scenario, not an afterthought, since this repository's own development database already contained real pre-Phase-1 data when Phase 1 began.

## Decision

- Adopt `sequelize-cli` (`.sequelizerc`, `server/config/config.js`, `server/migrations/`). `server/config/database.js` (the app's runtime connection) now reads from the same per-environment `config.js` definitions, so the running app and the CLI always agree on which database they're targeting — this was a real bug caught mid-phase (NODE_ENV=test previously still connected to the development database).
- The first migration (`20260725120001-create-core-tables.js`) recreates the seven pre-Phase-1 tables exactly as they existed under `sync()`, but checks `queryInterface.showAllTables()` and skips any table that already exists. This lets the exact same migration set run cleanly against both a brand-new empty database and this repository's own already-populated development database, without a separate "assume already synced" flag.
- Reference-data seeding (permission catalog, roles, the Website Guys organization) and the legacy-user backfill live inside migrations (`20260725120004`, `20260725120006`), not a separately-run seeder, because the backfill must run exactly once against real existing rows and be transactional with the schema change that makes it necessary. Every insert is still guarded (`ON CONFLICT DO NOTHING` / existence checks) so the migration is safe to re-run.
- `server/server.js` no longer calls `sync()` at all. It checks for the `SequelizeMeta` table and refuses to start with a clear error if migrations haven't been run, rather than silently altering the schema.

## Consequences

- Migrations were validated three ways during this phase: against a truly empty database, through a full down/up rollback cycle, and against a synthetic legacy-collision fixture (two pre-Phase-1 users who had independently saved the same business) — all three are now permanent automated tests (`server/tests/migrations.test.js`).
- One migration (`20260725120007`) exists purely to correct an index definition from an earlier migration in this same phase (the `SavedLeads` partial unique index needed to exclude archived rows, not just deleted ones) rather than editing the already-applied original — once a migration may have run anywhere, it is not edited in place; a corrective migration is added instead.
- Test-suite database resets deliberately drop and recreate the test database rather than running `db:migrate:undo:all` repeatedly, because migration 20260725120007's `down()` is not safe to run once realistic archived+active data coexists for the same organization/lead pair (which the archive/restore tests themselves create) — see that migration's file comment and `server/tests/helpers/globalSetup.js`.

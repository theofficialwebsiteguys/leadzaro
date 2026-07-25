'use strict';

// Runs once before the whole Jest test run: drops and recreates the
// disposable test database from scratch, then migrates it fresh.
//
// Deliberately does NOT reuse `db:migrate:undo:all` against a database
// that may already contain data from a previous run — migration 007's
// down() recreates the old (organizationId, leadId) unique index scoped
// only to `deletedAt IS NULL`, which realistic test data (an archived
// SavedLead coexisting with a new active one for the same business,
// exactly what the archive/restore tests create) can violate, since two
// such rows both have `deletedAt IS NULL` under the new archivedAt-aware
// model. That's a legitimate one-way limitation of that corrective
// migration once data has accumulated under the new semantics, not
// something to work around here — a full drop/recreate sidesteps it and
// guarantees a truly clean slate for every test run regardless.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function run(cmd, args) {
  execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test' },
    shell: true,
  });
}

module.exports = async () => {
  const testDbName = process.env.DB_TEST_NAME || `${process.env.DB_NAME || 'leadzaro'}_test`;
  const admin = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'leadzaro_user',
    password: process.env.DB_PASS || 'leadzaro_pass',
    database: 'postgres',
  });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [testDbName]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${testDbName}"`);
    await admin.query(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end();
  }

  run('npx', ['sequelize-cli', 'db:migrate']);
};

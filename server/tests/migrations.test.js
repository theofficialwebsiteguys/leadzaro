'use strict';

// Exercises the migration set against a dedicated, throwaway database
// (never the shared server/tests test DB other suites use) via raw `pg`
// queries and a subprocess sequelize-cli, so it can safely reset/rebuild
// schema without disturbing anything else running in this Jest worker.

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..');
const DB_NAME = `leadzaro_migtest_${crypto.randomBytes(4).toString('hex')}`;

function runCli(args) {
  execFileSync('npx', ['sequelize-cli', ...args], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', DB_TEST_NAME: DB_NAME },
    stdio: 'pipe',
    shell: true,
  });
}

async function adminClient() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'leadzaro_user',
    password: process.env.DB_PASS || 'leadzaro_pass',
    database: 'postgres',
  });
  await client.connect();
  return client;
}

async function dbClient() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'leadzaro_user',
    password: process.env.DB_PASS || 'leadzaro_pass',
    database: DB_NAME,
  });
  await client.connect();
  return client;
}

beforeAll(async () => {
  const admin = await adminClient();
  await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  await admin.end();
});

afterAll(async () => {
  const admin = await adminClient();
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [DB_NAME]
  );
  await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
  await admin.end();
});

test('migrations apply cleanly to an empty database', async () => {
  runCli(['db:migrate']);

  const client = await dbClient();
  try {
    const { rows } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tableNames = rows.map((r) => r.table_name);
    for (const expected of ['Users', 'Organizations', 'OrganizationMemberships', 'Roles', 'Permissions', 'Invitations', 'AuthSessions', 'AuditLogs']) {
      expect(tableNames).toContain(expected);
    }

    const { rows: orgRows } = await client.query('SELECT slug FROM "Organizations"');
    expect(orgRows.map((r) => r.slug)).toContain('the-website-guys');

    const { rows: roleCount } = await client.query('SELECT COUNT(*) FROM "Roles"');
    expect(Number(roleCount[0].count)).toBeGreaterThanOrEqual(15);

    // Phase 4's opening backfill migration (20260727120002): the seeded
    // demo-client organization predates Phase 3 and has no
    // ConversionAttempt at all — the critical correction an independent
    // review required was that Project.agencyOrganizationId must still
    // come from Organization.managingAgencyOrganizationId directly, not
    // be left null because no ConversionAttempt exists to source it from.
    const { rows: demoProjectRows } = await client.query(`
      SELECT p."agencyOrganizationId", p."sourceConversionAttemptId", o."managingAgencyOrganizationId"
      FROM "Projects" p JOIN "Organizations" o ON o.id = p."organizationId"
      WHERE o.slug = 'demo-client'
    `);
    expect(demoProjectRows).toHaveLength(1);
    expect(demoProjectRows[0].agencyOrganizationId).not.toBeNull();
    expect(demoProjectRows[0].agencyOrganizationId).toBe(demoProjectRows[0].managingAgencyOrganizationId);
    expect(demoProjectRows[0].sourceConversionAttemptId).toBeNull();
  } finally {
    await client.end();
  }
});

test('full rollback and re-migration is safe (idempotent-safe against legacy tables)', async () => {
  runCli(['db:migrate:undo:all']);

  const clientAfterUndo = await dbClient();
  try {
    const { rows: tablesAfterUndo } = await clientAfterUndo.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'SequelizeMeta'"
    );
    expect(tablesAfterUndo.length).toBe(0);
  } finally {
    await clientAfterUndo.end();
  }

  // Re-migrate onto the now-empty (but previously-migrated) database. Only
  // two seeded users should exist — no real legacy users: the demo-client
  // user (Phase 1) and the non-loginable system user (Phase 3, § 7b) used
  // as the actor for webhook-triggered client invitations.
  runCli(['db:migrate']);
  const client = await dbClient();
  try {
    const { rows } = await client.query('SELECT email FROM "Users" ORDER BY email ASC');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.email)).toEqual([
      'demo-client@thewebsiteguys.internal',
      'system@internal.leadzaro.local',
    ]);
  } finally {
    await client.end();
  }
}, 30000);

test('organization-scope migration safely merges a legacy duplicate SavedLead collision', async () => {
  runCli(['db:migrate:undo:all']);
  runCli(['db:migrate', '--to', '20260725120001-create-core-tables.js']);

  const client = await dbClient();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const savedLeadOld = crypto.randomUUID();
  const savedLeadNew = crypto.randomUUID();
  const now = new Date();
  const earlier = new Date(now.getTime() - 60000);

  await client.query(
    `INSERT INTO "Users" (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt")
     VALUES ($1,'Legacy Rep A','rep-a@migtest.test','x','admin',true,$3,$3), ($2,'Legacy Rep B','rep-b@migtest.test','x','user',true,$3,$3)`,
    [userA, userB, now]
  );
  await client.query(
    `INSERT INTO "Leads" (id, name, "googlePlaceId", "createdAt", "updatedAt") VALUES ($1,'Collision Co','demo_collision', $2, $2)`,
    [leadId, now]
  );
  await client.query(
    `INSERT INTO "SavedLeads" (id, "userId", "leadId", status, priority, "createdAt", "updatedAt")
     VALUES ($1,$3,$5,'Saved','Medium',$6,$6), ($2,$4,$5,'Contacted','High',$7,$7)`,
    [savedLeadOld, savedLeadNew, userA, userB, leadId, earlier, now]
  );
  await client.end();

  runCli(['db:migrate']);

  const verify = await dbClient();
  try {
    const { rows: savedLeads } = await verify.query(
      'SELECT id, "deletedAt", "archivedAt" FROM "SavedLeads" WHERE "leadId" = $1 ORDER BY "createdAt" ASC',
      [leadId]
    );
    expect(savedLeads).toHaveLength(2);
    expect(savedLeads[0].deletedAt).toBeNull();
    expect(savedLeads[1].deletedAt).not.toBeNull();

    const { rows: audit } = await verify.query(
      `SELECT "targetId", metadata FROM "AuditLogs" WHERE action = 'saved_lead.auto_merged_duplicate'`
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].targetId).toBe(savedLeadNew);
    expect(audit[0].metadata.canonicalSavedLeadId).toBe(savedLeadOld);

    const { rows: adminRole } = await verify.query(`
      SELECT r.key FROM "MembershipRoles" mr
      JOIN "OrganizationMemberships" om ON om.id = mr."membershipId"
      JOIN "Roles" r ON r.id = mr."roleId"
      WHERE om."userId" = $1
    `, [userA]);
    expect(adminRole.map((r) => r.key)).toContain('administrator');

    const { rows: repRole } = await verify.query(`
      SELECT r.key FROM "MembershipRoles" mr
      JOIN "OrganizationMemberships" om ON om.id = mr."membershipId"
      JOIN "Roles" r ON r.id = mr."roleId"
      WHERE om."userId" = $1
    `, [userB]);
    expect(repRole.map((r) => r.key)).toContain('sales_representative');
  } finally {
    await verify.end();
  }
}, 30000);

test('Phase 2 Opportunity backfill creates exactly one prospect Organization per (organization, lead) pair, even when an active and an archived SavedLead both exist for it', async () => {
  runCli(['db:migrate:undo:all']);
  // Must include migration 007 (the corrected partial-unique index that
  // excludes archived rows, not just deleted ones) before inserting the
  // fixture below — under the original migration-5 index, an archived
  // and an active SavedLead for the same (org, lead) would collide at
  // the DB level, which is exactly the bug 007 fixed.
  runCli(['db:migrate', '--to', '20260725120007-fix-saved-lead-active-unique-index.js']);

  const client = await dbClient();
  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const leadId = crypto.randomUUID();
  const savedLeadArchived = crypto.randomUUID();
  const savedLeadActive = crypto.randomUUID();
  const now = new Date();
  const earlier = new Date(now.getTime() - 120000);

  await client.query(
    `INSERT INTO "Organizations" (id, name, slug, type, status, "createdAt", "updatedAt")
     VALUES ($1, 'Fixture Agency', 'fixture-agency-crm-test', 'agency', 'active', $2, $2)`,
    [orgId, now]
  );
  await client.query(
    `INSERT INTO "Users" (id, name, email, "passwordHash", role, "isActive", "createdAt", "updatedAt")
     VALUES ($1,'Fixture Rep','rep@crmfixture.test','x','user',true,$2,$2)`,
    [userId, now]
  );
  await client.query(
    `INSERT INTO "Leads" (id, name, "googlePlaceId", "createdAt", "updatedAt") VALUES ($1,'Same Business Twice','demo_crm_collision', $2, $2)`,
    [leadId, now]
  );
  // One archived SavedLead (an earlier pursuit that was archived) and one
  // active SavedLead (re-saved later) for the exact same (org, lead) pair
  // — a state directly reachable today via the archive-then-resave flow
  // this repository's own Phase 1 tests exercise.
  await client.query(
    `INSERT INTO "SavedLeads" (id, "organizationId", "userId", "leadId", status, priority, "archivedAt", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'Not Interested','Medium',$5,$5,$5)`,
    [savedLeadArchived, orgId, userId, leadId, earlier]
  );
  await client.query(
    `INSERT INTO "SavedLeads" (id, "organizationId", "userId", "leadId", status, priority, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'Interested','High',$5,$5)`,
    [savedLeadActive, orgId, userId, leadId, now]
  );
  await client.end();

  runCli(['db:migrate']);

  const verify = await dbClient();
  try {
    const { rows: prospects } = await verify.query(
      `SELECT o.id, o.name FROM "Organizations" o
       JOIN "Opportunities" op ON op."organizationId" = o.id
       WHERE op."sourceLeadId" = $1`,
      [leadId]
    );
    expect(prospects).toHaveLength(1);

    const { rows: opportunities } = await verify.query(
      `SELECT stage, "archivedAt", "agencyOrganizationId", "assignedToUserId" FROM "Opportunities" WHERE "sourceLeadId" = $1`,
      [leadId]
    );
    expect(opportunities).toHaveLength(1);
    // The active SavedLead ('Interested') drives the stage, not the
    // archived one ('Not Interested') — and the resulting Opportunity is
    // itself active (not archived), matching its active source row.
    expect(opportunities[0].stage).toBe('Qualified');
    expect(opportunities[0].archivedAt).toBeNull();
    expect(opportunities[0].agencyOrganizationId).toBe(orgId);
    expect(opportunities[0].assignedToUserId).toBe(userId);
  } finally {
    await verify.end();
  }
}, 30000);

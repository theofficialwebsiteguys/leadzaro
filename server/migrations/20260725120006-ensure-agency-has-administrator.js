'use strict';

const crypto = require('node:crypto');

/**
 * Safety net discovered while smoke-testing against this machine's real
 * dev database: the legacy backfill (migration 4) maps legacy
 * `role: 'admin'` to the Administrator role and everyone else to Sales
 * Representative. If no legacy user happened to have `role: 'admin'` set
 * (true of this repository's own dev data — the account owner's row was
 * never flagged admin), the resulting organization has zero
 * Administrators and nobody can invite anyone, manage roles, or view
 * audit history. That is an unrecoverable dead end without direct
 * database access, so this migration guarantees every agency
 * organization ends up with at least one Administrator, promoting the
 * earliest-created active employee membership when none already has the
 * role. Idempotent and safe to run against an org that already has an
 * administrator (no-op).
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      const [agencyOrgs] = await query(`SELECT id FROM "Organizations" WHERE type = 'agency'`);
      const [adminRoleRows] = await query(`SELECT id FROM "Roles" WHERE key = 'administrator' LIMIT 1`);
      const administratorRoleId = adminRoleRows[0]?.id;
      if (!administratorRoleId) return;

      for (const org of agencyOrgs) {
        const [existingAdmins] = await query(`
          SELECT 1
          FROM "MembershipRoles" mr
          JOIN "OrganizationMemberships" om ON om.id = mr."membershipId"
          WHERE om."organizationId" = :orgId AND mr."roleId" = :roleId AND om.status = 'active' AND om."deletedAt" IS NULL
          LIMIT 1
        `, { orgId: org.id, roleId: administratorRoleId });

        if (existingAdmins.length > 0) continue;

        const [earliestMembership] = await query(`
          SELECT id FROM "OrganizationMemberships"
          WHERE "organizationId" = :orgId AND status = 'active' AND "deletedAt" IS NULL AND "membershipType" = 'employee'
          ORDER BY "createdAt" ASC
          LIMIT 1
        `, { orgId: org.id });

        const membershipId = earliestMembership[0]?.id;
        if (!membershipId) continue;

        await query(`
          INSERT INTO "MembershipRoles" (id, "membershipId", "roleId", "assignedByUserId", "createdAt", "updatedAt")
          VALUES (:id, :membershipId, :roleId, NULL, :now, :now)
          ON CONFLICT ("membershipId", "roleId") DO NOTHING
        `, {
          id: crypto.randomUUID(), membershipId, roleId: administratorRoleId, now,
        });
      }
    });
  },

  async down() {
    // Intentionally not reversed: this migration only ever *adds* an
    // Administrator role to a membership that had none, which is a safety
    // guarantee, not a data change that should be undone by a later
    // rollback (rolling it back could leave an organization with no
    // administrator again).
  },
};

'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { ALL_ROLES, PERMISSIONS } = require('../core/authorization/catalog');

const WEBSITE_GUYS_SLUG = 'the-website-guys';
const DEMO_CLIENT_SLUG = 'demo-client';
const DEMO_CLIENT_EMAIL = 'demo-client@thewebsiteguys.internal';

/**
 * Seeds the Phase 1 reference data (permission catalog, predefined roles,
 * the Website Guys agency organization) and backfills every existing User
 * into a Website Guys membership with a role derived from their legacy
 * `role` field. Also seeds one demo client organization + member so the
 * impersonation foundation (Phase 1 section K) has something real to
 * demonstrate against, without building fake project UI.
 *
 * Fully idempotent: every insert is guarded by an existence check or
 * `ON CONFLICT DO NOTHING`, so this migration can safely be re-run (e.g.
 * after a partial failure) without creating duplicates.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      // ── 1. Website Guys organization ──────────────────────────────────
      const [existingOrg] = await query(
        `SELECT id FROM "Organizations" WHERE slug = :slug LIMIT 1`,
        { slug: WEBSITE_GUYS_SLUG }
      );
      let websiteGuysOrgId = existingOrg[0]?.id;
      if (!websiteGuysOrgId) {
        websiteGuysOrgId = crypto.randomUUID();
        await queryInterface.bulkInsert('Organizations', [{
          id: websiteGuysOrgId,
          name: 'The Website Guys',
          slug: WEBSITE_GUYS_SLUG,
          type: 'agency',
          status: 'active',
          branding: null,
          createdAt: now,
          updatedAt: now,
        }], { transaction });
      }

      // ── 2. Permission catalog (insert-or-ignore by unique key) ────────
      for (const perm of PERMISSIONS) {
        await query(
          `INSERT INTO "Permissions" (id, key, category, description, "createdAt", "updatedAt")
           VALUES (:id, :key, :category, :description, :now, :now)
           ON CONFLICT (key) DO NOTHING`,
          { id: crypto.randomUUID(), key: perm.key, category: perm.category, description: perm.description, now }
        );
      }
      const [permRows] = await query(`SELECT id, key FROM "Permissions"`);
      const permissionIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

      // ── 3. Role catalog + role→permission mappings ────────────────────
      for (const role of ALL_ROLES) {
        await query(
          `INSERT INTO "Roles" (id, key, name, scope, "isSystem", description, "createdAt", "updatedAt")
           VALUES (:id, :key, :name, :scope, true, :description, :now, :now)
           ON CONFLICT (key) DO NOTHING`,
          { id: crypto.randomUUID(), key: role.key, name: role.name, scope: role.scope, description: role.name, now }
        );
      }
      const [roleRows] = await query(`SELECT id, key FROM "Roles"`);
      const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

      for (const role of ALL_ROLES) {
        const roleId = roleIdByKey.get(role.key);
        for (const permKey of role.permissions) {
          const permissionId = permissionIdByKey.get(permKey);
          if (!roleId || !permissionId) continue;
          await query(
            `INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
             VALUES (:id, :roleId, :permissionId, :now, :now)
             ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
            { id: crypto.randomUUID(), roleId, permissionId, now }
          );
        }
      }

      // ── 4. Backfill every existing User into a Website Guys membership ─
      const [users] = await query(`SELECT id, role FROM "Users"`);
      for (const user of users) {
        const [existingMembership] = await query(
          `SELECT id FROM "OrganizationMemberships" WHERE "organizationId" = :orgId AND "userId" = :userId LIMIT 1`,
          { orgId: websiteGuysOrgId, userId: user.id }
        );
        let membershipId = existingMembership[0]?.id;
        if (!membershipId) {
          membershipId = crypto.randomUUID();
          await queryInterface.bulkInsert('OrganizationMemberships', [{
            id: membershipId,
            organizationId: websiteGuysOrgId,
            userId: user.id,
            status: 'active',
            membershipType: 'employee',
            title: null,
            invitedAt: null,
            acceptedAt: now,
            createdAt: now,
            updatedAt: now,
          }], { transaction });
        }

        const roleKey = user.role === 'admin' ? 'administrator' : 'sales_representative';
        const roleId = roleIdByKey.get(roleKey);
        if (roleId) {
          await query(
            `INSERT INTO "MembershipRoles" (id, "membershipId", "roleId", "assignedByUserId", "createdAt", "updatedAt")
             VALUES (:id, :membershipId, :roleId, NULL, :now, :now)
             ON CONFLICT ("membershipId", "roleId") DO NOTHING`,
            { id: crypto.randomUUID(), membershipId, roleId, now }
          );
        }
      }

      // ── 5. Seed a demo client organization + member for the ───────────
      //      impersonation foundation (Phase 1 section K). This account
      //      has a random, never-recorded password: the only intended
      //      access path is an administrator's "View As" action, not login.
      const [existingDemoOrg] = await query(
        `SELECT id FROM "Organizations" WHERE slug = :slug LIMIT 1`,
        { slug: DEMO_CLIENT_SLUG }
      );
      let demoClientOrgId = existingDemoOrg[0]?.id;
      if (!demoClientOrgId) {
        demoClientOrgId = crypto.randomUUID();
        await queryInterface.bulkInsert('Organizations', [{
          id: demoClientOrgId,
          name: 'Demo Client (Impersonation Test)',
          slug: DEMO_CLIENT_SLUG,
          type: 'client',
          status: 'active',
          branding: null,
          createdAt: now,
          updatedAt: now,
        }], { transaction });
      }

      const [existingDemoUser] = await query(
        `SELECT id FROM "Users" WHERE email = :email LIMIT 1`,
        { email: DEMO_CLIENT_EMAIL }
      );
      let demoClientUserId = existingDemoUser[0]?.id;
      if (!demoClientUserId) {
        demoClientUserId = crypto.randomUUID();
        const randomPasswordHash = await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 10);
        await queryInterface.bulkInsert('Users', [{
          id: demoClientUserId,
          name: 'Demo Client Contact',
          email: DEMO_CLIENT_EMAIL,
          passwordHash: randomPasswordHash,
          companyName: 'Demo Client Co.',
          salespersonType: 'Custom / Other',
          role: 'user',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }], { transaction });
      }

      const [existingDemoMembership] = await query(
        `SELECT id FROM "OrganizationMemberships" WHERE "organizationId" = :orgId AND "userId" = :userId LIMIT 1`,
        { orgId: demoClientOrgId, userId: demoClientUserId }
      );
      let demoMembershipId = existingDemoMembership[0]?.id;
      if (!demoMembershipId) {
        demoMembershipId = crypto.randomUUID();
        await queryInterface.bulkInsert('OrganizationMemberships', [{
          id: demoMembershipId,
          organizationId: demoClientOrgId,
          userId: demoClientUserId,
          status: 'active',
          membershipType: 'client',
          title: 'Client Owner',
          invitedAt: null,
          acceptedAt: now,
          createdAt: now,
          updatedAt: now,
        }], { transaction });
      }

      const clientOwnerRoleId = roleIdByKey.get('client_owner');
      if (clientOwnerRoleId) {
        await query(
          `INSERT INTO "MembershipRoles" (id, "membershipId", "roleId", "assignedByUserId", "createdAt", "updatedAt")
           VALUES (:id, :membershipId, :roleId, NULL, :now, :now)
           ON CONFLICT ("membershipId", "roleId") DO NOTHING`,
          { id: crypto.randomUUID(), membershipId: demoMembershipId, roleId: clientOwnerRoleId, now }
        );
      }
    });
  },

  async down(queryInterface) {
    // Reference-data seed: intentionally not reversed automatically, since
    // by the time later migrations/backfills run, other tables may already
    // reference these rows (memberships, sessions, audit entries). Manual
    // cleanup is documented in the phase completion report if a full
    // rollback of Phase 1 is ever required.
  },
};

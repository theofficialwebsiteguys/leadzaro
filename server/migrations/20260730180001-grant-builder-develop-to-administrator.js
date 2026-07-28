'use strict';

const crypto = require('node:crypto');

/**
 * Fixes a gap found during Phase 7 browser smoke testing: catalog.js's
 * own EMPLOYEE_ROLES definition documents administrator as holding
 * every permission (`permissions: PERMISSIONS.map((p) => p.key)`), and
 * the builder.manage seed migration (20260728140002) correctly granted
 * that new permission to administrator alongside project_manager — but
 * the builder.develop seed migration (20260729120002, Phase 6) only
 * granted it to developer/advanced_designer, omitting administrator.
 * The practical effect: an administrator lost the ability to see the
 * Repository/Deployments/Development Handoffs/Merge Back panels or
 * trigger code generation, silently, since Phase 6 shipped — a real
 * regression against the documented "administrator = all permissions"
 * invariant, not a new decision. Purely additive; idempotent via
 * ON CONFLICT DO NOTHING.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      const [permRows] = await query(`SELECT id, key FROM "Permissions" WHERE key = 'builder.develop'`);
      if (!permRows.length) return;
      const permissionId = permRows[0].id;

      const [roleRows] = await query(`SELECT id FROM "Roles" WHERE key = 'administrator'`);
      if (!roleRows.length) return;
      const roleId = roleRows[0].id;

      await query(
        `INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
         VALUES (:id, :roleId, :permissionId, :now, :now)
         ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
        {
          id: crypto.randomUUID(), roleId, permissionId, now,
        }
      );
    });
  },

  async down() {
    // Reference-data seed: not reversed, matching prior precedent.
  },
};

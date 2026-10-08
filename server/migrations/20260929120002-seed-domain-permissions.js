'use strict';

const crypto = require('node:crypto');

/**
 * domains.view (ADR 0010) — the read-only Domains list and domain pages.
 * Granted to every employee role; admins can restrict it per member through
 * the existing permission-override system.
 */
const PERMISSIONS = [
  { key: 'domains.view', category: 'domains', description: 'View the Domains inventory and domain details' },
];
const EMPLOYEE_ROLES = ['administrator', 'sales_representative', 'sales_manager', 'project_manager', 'designer', 'advanced_designer', 'developer', 'support', 'billing'];
const GRANTS = {
  'domains.view': EMPLOYEE_ROLES,
};

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      for (const permission of PERMISSIONS) {
        // eslint-disable-next-line no-await-in-loop
        await query(
          `INSERT INTO "Permissions" (id, key, category, description, "createdAt", "updatedAt")
           VALUES (:id, :key, :category, :description, :now, :now) ON CONFLICT (key) DO NOTHING`,
          { id: crypto.randomUUID(), ...permission, now },
        );
      }
      const [permissions] = await query('SELECT id, key FROM "Permissions" WHERE key IN (:keys)', { keys: PERMISSIONS.map((p) => p.key) });
      const [roles] = await query('SELECT id, key FROM "Roles" WHERE key IN (:keys)', { keys: EMPLOYEE_ROLES });
      for (const permission of permissions) {
        for (const role of roles.filter((r) => GRANTS[permission.key].includes(r.key))) {
          // eslint-disable-next-line no-await-in-loop
          await query(
            `INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
             VALUES (:id, :roleId, :permissionId, :now, :now) ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
            {
              id: crypto.randomUUID(), roleId: role.id, permissionId: permission.id, now,
            },
          );
        }
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      const keys = PERMISSIONS.map((p) => p.key);
      await query('DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key IN (:keys))', { keys });
      await query('DELETE FROM "MembershipPermissionOverrides" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key IN (:keys))', { keys });
      await query('DELETE FROM "Permissions" WHERE key IN (:keys)', { keys });
    });
  },
};

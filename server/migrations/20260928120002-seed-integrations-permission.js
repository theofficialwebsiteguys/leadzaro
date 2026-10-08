'use strict';

const crypto = require('node:crypto');

/**
 * integrations.manage — connect, test, sync and disconnect third-party
 * accounts such as Namecheap (ADR 0009). Administrators only: holding it
 * means being able to point the workspace at a registrar account.
 */
const PERMISSION = { key: 'integrations.manage', category: 'integrations', description: 'Connect, test, sync and disconnect third-party accounts such as Namecheap' };
const ROLE_KEYS = ['administrator'];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      await query(
        `INSERT INTO "Permissions" (id, key, category, description, "createdAt", "updatedAt")
         VALUES (:id, :key, :category, :description, :now, :now)
         ON CONFLICT (key) DO NOTHING`,
        {
          id: crypto.randomUUID(), ...PERMISSION, now,
        },
      );
      const [[permission]] = await query('SELECT id FROM "Permissions" WHERE key = :key', { key: PERMISSION.key });
      const [roles] = await query('SELECT id FROM "Roles" WHERE key IN (:keys)', { keys: ROLE_KEYS });
      for (const role of roles) {
        // eslint-disable-next-line no-await-in-loop
        await query(
          `INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
           VALUES (:id, :roleId, :permissionId, :now, :now)
           ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
          {
            id: crypto.randomUUID(), roleId: role.id, permissionId: permission.id, now,
          },
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      await query('DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key = :key)', { key: PERMISSION.key });
      await query('DELETE FROM "MembershipPermissionOverrides" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key = :key)', { key: PERMISSION.key });
      await query('DELETE FROM "Permissions" WHERE key = :key', { key: PERMISSION.key });
    });
  },
};

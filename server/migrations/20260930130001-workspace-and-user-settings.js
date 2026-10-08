'use strict';

const crypto = require('node:crypto');

/**
 * Settings reorganisation (ADR 0012).
 * - Organizations.settings: workspace-wide defaults (timezone, default
 *   search location/keywords, default follow-up days). Company contact
 *   details reuse the Organization columns added by ADR 0011.
 * - Users.preferences: personal sales preferences (signature, search
 *   radius, follow-up days). Personal search keywords/location keep using
 *   the existing Users.targetIndustry / serviceArea columns.
 * - workspace.manage: edit the workspace profile and defaults (admins).
 * - Untouched default email templates end with {{my_signature}} instead of
 *   name + phone, so each salesperson's signature is used.
 */
const PERMISSION = { key: 'workspace.manage', category: 'admin', description: 'Edit the company profile and workspace-wide defaults' };

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      await queryInterface.addColumn('Organizations', 'settings', { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, { transaction });
      await queryInterface.addColumn('Users', 'preferences', { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, { transaction });

      await query(
        `INSERT INTO "Permissions" (id, key, category, description, "createdAt", "updatedAt")
         VALUES (:id, :key, :category, :description, :now, :now) ON CONFLICT (key) DO NOTHING`,
        { id: crypto.randomUUID(), ...PERMISSION, now },
      );
      await query(
        `INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
         SELECT gen_random_uuid(), r.id, p.id, :now, :now FROM "Roles" r, "Permissions" p
         WHERE r.key = 'administrator' AND p.key = :key
         ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
        { key: PERMISSION.key, now },
      );

      await query(`UPDATE "MessageTemplates"
        SET body = regexp_replace(body, E'\\\\{\\\\{my_name\\\\}\\\\}\\n\\\\{\\\\{my_phone\\\\}\\\\}$', '{{my_signature}}')
        WHERE "isDefault" = true AND "updatedByUserId" IS NULL AND channel = 'email'`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });
      await query(`UPDATE "MessageTemplates" SET body = regexp_replace(body, E'\\\\{\\\\{my_signature\\\\}\\\\}$', E'{{my_name}}\\n{{my_phone}}') WHERE "isDefault" = true`);
      await query('DELETE FROM "RolePermissions" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key = :key)', { key: PERMISSION.key });
      await query('DELETE FROM "MembershipPermissionOverrides" WHERE "permissionId" IN (SELECT id FROM "Permissions" WHERE key = :key)', { key: PERMISSION.key });
      await query('DELETE FROM "Permissions" WHERE key = :key', { key: PERMISSION.key });
      await queryInterface.removeColumn('Users', 'preferences', { transaction });
      await queryInterface.removeColumn('Organizations', 'settings', { transaction });
    });
  },
};

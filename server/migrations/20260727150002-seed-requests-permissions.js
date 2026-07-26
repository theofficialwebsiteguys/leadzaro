'use strict';

const crypto = require('node:crypto');

/**
 * Phase 4 slice 4. requests.create -> every client role except
 * `viewer` (matching messages.post's precedent). requests.manage ->
 * the same hands-on employee roles as tasks.manage, since request
 * categories (content/image/hours/page_section/design/form/bug/
 * domain/analytics/functionality/emergency) span the same skillsets.
 */
const NEW_PERMISSIONS = [
  { key: 'requests.create', category: 'projects', description: 'Submit a client request or content inbox item' },
  { key: 'requests.manage', category: 'projects', description: 'Triage, update, and convert client requests (the unified support queue)' },
];

const GRANTS = {
  administrator: ['requests.create', 'requests.manage'],
  project_manager: ['requests.manage'],
  designer: ['requests.manage'],
  advanced_designer: ['requests.manage'],
  developer: ['requests.manage'],
  support: ['requests.manage'],
  client_owner: ['requests.create'],
  project_contact: ['requests.create'],
  marketing: ['requests.create'],
  billing_contact: ['requests.create'],
  content_editor: ['requests.create'],
};

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      for (const perm of NEW_PERMISSIONS) {
        await query(
          `INSERT INTO "Permissions" (id, key, category, description, "createdAt", "updatedAt")
           VALUES (:id, :key, :category, :description, :now, :now)
           ON CONFLICT (key) DO NOTHING`,
          {
            id: crypto.randomUUID(), key: perm.key, category: perm.category, description: perm.description, now,
          }
        );
      }

      const [permRows] = await query(`SELECT id, key FROM "Permissions"`);
      const permissionIdByKey = new Map(permRows.map((r) => [r.key, r.id]));
      const [roleRows] = await query(`SELECT id, key FROM "Roles"`);
      const roleIdByKey = new Map(roleRows.map((r) => [r.key, r.id]));

      for (const [roleKey, permissionKeys] of Object.entries(GRANTS)) {
        const roleId = roleIdByKey.get(roleKey);
        if (!roleId) continue;
        for (const permKey of permissionKeys) {
          const permissionId = permissionIdByKey.get(permKey);
          if (!permissionId) continue;
          await query(
            `INSERT INTO "RolePermissions" (id, "roleId", "permissionId", "createdAt", "updatedAt")
             VALUES (:id, :roleId, :permissionId, :now, :now)
             ON CONFLICT ("roleId", "permissionId") DO NOTHING`,
            {
              id: crypto.randomUUID(), roleId, permissionId, now,
            }
          );
        }
      }
    });
  },

  async down() {
    // Reference-data seed: not reversed, matching prior precedent.
  },
};

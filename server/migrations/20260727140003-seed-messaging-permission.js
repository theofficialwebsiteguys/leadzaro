'use strict';

const crypto = require('node:crypto');

/**
 * Phase 4 slice 3. Granted broadly to every employee role and every
 * client role except `viewer` — the one finer-grained per-role
 * distinction this phase has a concrete need for (a role named
 * "Viewer" should not be able to post messages).
 */
const NEW_PERMISSIONS = [
  { key: 'messages.post', category: 'projects', description: 'Post messages in a project channel visible to the requester' },
];

const GRANTS = {
  administrator: ['messages.post'],
  sales_representative: ['messages.post'],
  sales_manager: ['messages.post'],
  project_manager: ['messages.post'],
  designer: ['messages.post'],
  advanced_designer: ['messages.post'],
  developer: ['messages.post'],
  support: ['messages.post'],
  billing: ['messages.post'],
  client_owner: ['messages.post'],
  project_contact: ['messages.post'],
  marketing: ['messages.post'],
  billing_contact: ['messages.post'],
  content_editor: ['messages.post'],
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

'use strict';

const crypto = require('node:crypto');

/**
 * Phase 4 slice 6. files.upload -> every employee role and every client
 * role except viewer (matching messages.post/requests.create/
 * meetings.request precedent). files.manage (delete) -> the same
 * hands-on employee roles as tasks.manage/requests.manage/meetings.manage.
 */
const NEW_PERMISSIONS = [
  { key: 'files.upload', category: 'projects', description: 'Upload a file to a project' },
  { key: 'files.manage', category: 'projects', description: 'Delete project files' },
];

const GRANTS = {
  administrator: ['files.upload', 'files.manage'],
  sales_representative: ['files.upload'],
  sales_manager: ['files.upload'],
  project_manager: ['files.upload', 'files.manage'],
  designer: ['files.upload', 'files.manage'],
  advanced_designer: ['files.upload', 'files.manage'],
  developer: ['files.upload', 'files.manage'],
  support: ['files.upload', 'files.manage'],
  billing: ['files.upload'],
  client_owner: ['files.upload'],
  project_contact: ['files.upload'],
  marketing: ['files.upload'],
  billing_contact: ['files.upload'],
  content_editor: ['files.upload'],
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

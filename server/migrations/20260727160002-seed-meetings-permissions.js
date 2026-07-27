'use strict';

const crypto = require('node:crypto');

/**
 * Phase 4 slice 5. meetings.request -> every employee role and every
 * client role (either side can request a meeting). meetings.manage ->
 * the same hands-on employee roles as tasks.manage/requests.manage
 * (confirm/decline/cancel, which triggers the real GoogleCalendarAdapter
 * call).
 */
const NEW_PERMISSIONS = [
  { key: 'meetings.request', category: 'projects', description: 'Request a project meeting' },
  { key: 'meetings.manage', category: 'projects', description: 'Confirm, decline, and cancel project meetings' },
];

const GRANTS = {
  administrator: ['meetings.request', 'meetings.manage'],
  sales_representative: ['meetings.request'],
  sales_manager: ['meetings.request'],
  project_manager: ['meetings.request', 'meetings.manage'],
  designer: ['meetings.request', 'meetings.manage'],
  advanced_designer: ['meetings.request', 'meetings.manage'],
  developer: ['meetings.request', 'meetings.manage'],
  support: ['meetings.request', 'meetings.manage'],
  billing: ['meetings.request'],
  client_owner: ['meetings.request'],
  project_contact: ['meetings.request'],
  marketing: ['meetings.request'],
  billing_contact: ['meetings.request'],
  content_editor: ['meetings.request'],
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

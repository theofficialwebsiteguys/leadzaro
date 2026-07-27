'use strict';

const crypto = require('node:crypto');

/**
 * Phase 4 slice 8. cancellations.request -> administrator/project_manager
 * (agency-initiated) and every client role except `viewer` (client-
 * initiated), matching requests.create's client-side breadth.
 * cancellations.manage (confirm/withdraw) -> administrator/
 * project_manager only, deliberately narrower than tasks.manage/
 * requests.manage/meetings.manage's hands-on-employee-role breadth:
 * ending a client engagement is a business decision, not day-to-day
 * project work, matching projects.change_stage's precedent.
 */
const NEW_PERMISSIONS = [
  { key: 'cancellations.request', category: 'projects', description: 'Request cancellation of a project engagement' },
  { key: 'cancellations.manage', category: 'projects', description: 'Confirm or withdraw a project cancellation request' },
];

const GRANTS = {
  administrator: ['cancellations.request', 'cancellations.manage'],
  project_manager: ['cancellations.request', 'cancellations.manage'],
  client_owner: ['cancellations.request'],
  project_contact: ['cancellations.request'],
  marketing: ['cancellations.request'],
  billing_contact: ['cancellations.request'],
  content_editor: ['cancellations.request'],
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

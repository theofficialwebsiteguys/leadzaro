'use strict';

const crypto = require('node:crypto');

/**
 * Phase 5 slice 1. builder.edit -> designer/advanced_designer/developer
 * (employee) and client_owner/marketing/content_editor (client) -
 * deliberately narrower than the "everyone except viewer" pattern used
 * for messages/requests/meetings, since editing a live client website
 * is a materially bigger action (current-phase-plan.md § 2g).
 * builder.publish -> administrator/project_manager/advanced_designer/
 * developer only, matching cancellations.manage's "business decision,
 * not day-to-day work" precedent - no client role ever gets it.
 */
const NEW_PERMISSIONS = [
  { key: 'builder.edit', category: 'builder', description: 'Edit a project\'s website in the builder' },
  { key: 'builder.publish', category: 'builder', description: 'Approve and publish a pending website version' },
];

const GRANTS = {
  administrator: ['builder.edit', 'builder.publish'],
  project_manager: ['builder.publish'],
  designer: ['builder.edit'],
  advanced_designer: ['builder.edit', 'builder.publish'],
  developer: ['builder.edit', 'builder.publish'],
  client_owner: ['builder.edit'],
  marketing: ['builder.edit'],
  content_editor: ['builder.edit'],
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

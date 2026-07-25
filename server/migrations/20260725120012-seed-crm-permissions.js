'use strict';

const crypto = require('node:crypto');

/**
 * Adds the Phase 2 CRM permission catalog entries. A new migration
 * rather than editing the Phase 1 seed migration in place — once a
 * migration may have run anywhere, it isn't edited, a corrective/
 * additive one is added instead (see ADR 0004).
 *
 * `leads.merge` already existed as a reserved-but-unused Phase 1 catalog
 * entry; granted here to the roles that need it now that prospect
 * merging is a real feature.
 */
const NEW_PERMISSIONS = [
  { key: 'crm.manage_pipeline', category: 'crm', description: 'Manage the CRM pipeline: stages, scoring, merging prospects' },
  { key: 'leads.assign', category: 'crm', description: 'Assign or reassign an opportunity to another employee' },
];

// role key -> permission keys granted (in addition to whatever they
// already have from the Phase 1 seed).
const GRANTS = {
  administrator: ['crm.manage_pipeline', 'leads.assign', 'leads.merge'],
  sales_manager: ['crm.manage_pipeline', 'leads.assign', 'leads.merge'],
  sales_representative: ['crm.manage_pipeline'],
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
    // Reference-data seed: not reversed, matching migration 4's
    // documented precedent (by the time a rollback would run, role
    // permissions may already be relied upon elsewhere).
  },
};

'use strict';

const crypto = require('node:crypto');

/**
 * Phase 4 (see docs/leadzaro/current-phase-plan.md § 2c/2d). `project_manager`
 * is the employee role that actually manages stage transitions/soft-gate
 * overrides; `administrator` gets it implicitly via the full permission
 * list already, but this migration doesn't re-run that seed so it's
 * granted explicitly here too. `projects.view` goes to every client role
 * uniformly, matching how they already uniformly hold
 * BASE_SELF_SERVICE_PERMISSIONS — Phase 4 is the first real module these
 * roles were reserved for since Phase 1.
 */
const NEW_PERMISSIONS = [
  { key: 'projects.view', category: 'projects', description: "View one's own client organization's project" },
  { key: 'projects.manage', category: 'projects', description: 'Manage project assignments and settings' },
  { key: 'projects.change_stage', category: 'projects', description: 'Change a project\'s stage, including overriding an incomplete soft-gate checklist' },
];

const GRANTS = {
  // projects.view granted to every employee role uniformly (§ 2d: "any
  // active employee membership at the owning agency can read a
  // project's internal content") and every client role uniformly
  // (matching how they already uniformly hold self-service permissions).
  administrator: ['projects.view', 'projects.manage', 'projects.change_stage'],
  sales_representative: ['projects.view'],
  sales_manager: ['projects.view'],
  project_manager: ['projects.view', 'projects.manage', 'projects.change_stage'],
  designer: ['projects.view'],
  advanced_designer: ['projects.view'],
  developer: ['projects.view'],
  support: ['projects.view'],
  billing: ['projects.view'],
  client_owner: ['projects.view'],
  project_contact: ['projects.view'],
  marketing: ['projects.view'],
  billing_contact: ['projects.view'],
  content_editor: ['projects.view'],
  viewer: ['projects.view'],
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

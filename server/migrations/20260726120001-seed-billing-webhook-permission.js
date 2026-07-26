'use strict';

const crypto = require('node:crypto');

/**
 * Phase 3 second slice (see docs/leadzaro/current-phase-plan.md § 7a).
 * Adds `billing.manage_webhooks`, gating the manual "reprocess a failed
 * Stripe webhook event" recovery path the independent review found was
 * missing (a failed lifecycle event was otherwise permanently stuck: no
 * re-throw reaches Stripe, so it never retries, and a Dashboard "resend"
 * redelivers the same event id, which the ledger's own dedupe swallows
 * without ever invoking the handler again).
 *
 * Granted to `administrator` (already implicit via the full permission
 * list in catalog.js, but explicit here since this migration doesn't
 * re-run that seed) and to the `billing` employee role — a placeholder
 * role seeded in Phase 1 specifically for "arrives with the modules that
 * need them," and this is that module's first real permission.
 */
const NEW_PERMISSIONS = [
  { key: 'billing.manage_webhooks', category: 'billing', description: 'View and manually reprocess failed Stripe webhook events' },
];

const GRANTS = {
  administrator: ['billing.manage_webhooks'],
  billing: ['billing.manage_webhooks'],
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
    // Reference-data seed: not reversed, matching migrations 4 and 12's
    // documented precedent.
  },
};

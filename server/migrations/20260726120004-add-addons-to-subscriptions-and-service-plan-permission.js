'use strict';

const crypto = require('node:crypto');

/**
 * Phase 3 roadmap completion (docs/planning/06_PHASES_2_TO_8_ROADMAP.md
 * lists "add-ons/entitlements" and "Stripe products/prices mapping" as
 * primary Phase 3 outcomes). Two independent additions bundled in one
 * migration since both close out the same roadmap gap-check:
 *
 * 1. `Subscriptions.addOnServicePlanIds` — add-on plans selected at
 *    Payment Link creation (already stored on PaymentLinkRequest) were
 *    never carried through to the resulting Subscription. One Subscription
 *    row per Stripe subscription id is the correct mapping (a real Stripe
 *    subscription has one id covering multiple line items), so add-ons
 *    are a JSONB list on that one row, not additional Subscription rows.
 * 2. `billing.manage_service_plans` — lets an administrator/billing-role
 *    user record a ServicePlan's Stripe product/price id mapping (manual,
 *    since this phase has no real Stripe credentials to auto-sync
 *    against).
 */
const NEW_PERMISSIONS = [
  { key: 'billing.manage_service_plans', category: 'billing', description: 'Manage the internal service/plan catalog and its Stripe product/price mapping' },
];

const GRANTS = {
  administrator: ['billing.manage_service_plans'],
  billing: ['billing.manage_service_plans'],
};

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Subscriptions', 'addOnServicePlanIds', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });

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

  async down(queryInterface) {
    await queryInterface.removeColumn('Subscriptions', 'addOnServicePlanIds');
    // Reference-data seed: not reversed, matching prior precedent.
  },
};

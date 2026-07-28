'use strict';

const crypto = require('node:crypto');

/**
 * Phase 8 slice 1. Seeds the SEO add-on's ServicePlan row (the real,
 * billing-driven entitlement path — a Subscription whose
 * addOnServicePlanIds includes this plan's id) and the
 * seo.manage_entitlements permission (the manual-grant path's write
 * gate). administrator + billing roles only, mirroring
 * billing.manage_service_plans' existing population exactly.
 */
const SEO_ADDON_PLAN = {
  key: 'seo_addon', name: 'Premium SEO', priceType: 'recurring', amountCents: 29900, billingInterval: 'month', sortOrder: 5,
};

const NEW_PERMISSIONS = [
  { key: 'seo.manage_entitlements', category: 'seo', description: 'Manually grant or revoke a client organization\'s SEO add-on entitlement' },
];

const GRANTS = {
  administrator: ['seo.manage_entitlements'],
  billing: ['seo.manage_entitlements'],
};

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      await query(
        `INSERT INTO "ServicePlans" (id, key, name, "priceType", "amountCents", "billingInterval", "isActive", "sortOrder", "createdAt", "updatedAt")
         VALUES (:id, :key, :name, :priceType, :amountCents, :billingInterval, true, :sortOrder, :now, :now)
         ON CONFLICT (key) DO NOTHING`,
        { id: crypto.randomUUID(), now, ...SEO_ADDON_PLAN }
      );

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

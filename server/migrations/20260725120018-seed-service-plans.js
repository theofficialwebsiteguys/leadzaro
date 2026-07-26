'use strict';

const crypto = require('node:crypto');

/**
 * A starting internal service catalog so Payment Link generation is
 * usable out of the box rather than requiring manual setup first.
 * Pricing is a reasonable placeholder an operator is expected to adjust
 * (via the ServicePlans table, or later an admin UI) — not a business
 * decision this migration is authoritative over. `stripeProductId`/
 * `stripePriceId` stay null until synced to a real Stripe account.
 */
const PLANS = [
  {
    key: 'starter_website', name: 'Starter Website', priceType: 'recurring', amountCents: 9900, billingInterval: 'month', sortOrder: 1,
  },
  {
    key: 'custom_website', name: 'Custom Website', priceType: 'one_time', amountCents: 250000, billingInterval: null, sortOrder: 2,
  },
  {
    key: 'website_redesign', name: 'Website Redesign', priceType: 'one_time', amountCents: 150000, billingInterval: null, sortOrder: 3,
  },
  {
    key: 'ongoing_management', name: 'Ongoing Website Management', priceType: 'recurring', amountCents: 4900, billingInterval: 'month', sortOrder: 4,
  },
];

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const plan of PLANS) {
      await queryInterface.sequelize.query(
        `INSERT INTO "ServicePlans" (id, key, name, "priceType", "amountCents", "billingInterval", "isActive", "sortOrder", "createdAt", "updatedAt")
         VALUES (:id, :key, :name, :priceType, :amountCents, :billingInterval, true, :sortOrder, :now, :now)
         ON CONFLICT (key) DO NOTHING`,
        { replacements: { id: crypto.randomUUID(), now, ...plan } }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DELETE FROM "ServicePlans" WHERE key IN (:keys)',
      { replacements: { keys: PLANS.map((p) => p.key) } }
    );
  },
};

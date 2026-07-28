'use strict';

/**
 * Phase 7 slice 8 (current-phase-plan.md § 5, slice 8) — domain
 * renewal tracking. renewalNoticeSentAt prevents re-notifying on every
 * check within the same cooldown window once a notice has already
 * gone out for the domain's current expiry.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('WebsiteDomains', 'renewalNoticeSentAt', { type: Sequelize.DATE, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('WebsiteDomains', 'renewalNoticeSentAt');
  },
};

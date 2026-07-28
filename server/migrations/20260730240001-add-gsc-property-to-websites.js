'use strict';

/**
 * Phase 8 slices 7-8 (current-phase-plan.md § 2e). Guided Google
 * Search Console connection — mirrors Website.googleAnalyticsMeasurementId's
 * exact precedent from Phase 7: Leadzaro never provisions/authenticates
 * a GSC property, only stores a value the agency/client already
 * verified themselves.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Websites', 'googleSearchConsolePropertyUrl', { type: Sequelize.STRING(500), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Websites', 'googleSearchConsolePropertyUrl');
  },
};

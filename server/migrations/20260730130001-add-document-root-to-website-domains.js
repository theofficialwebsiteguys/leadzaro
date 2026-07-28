'use strict';

/**
 * Phase 7 slice 2 (current-phase-plan.md § 2a) — document-root mapping:
 * which cPanel account/folder path currently serves a given domain.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('WebsiteDomains', 'cpanelAccount', { type: Sequelize.STRING(255), allowNull: true });
    await queryInterface.addColumn('WebsiteDomains', 'documentRootPath', { type: Sequelize.STRING(500), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('WebsiteDomains', 'documentRootPath');
    await queryInterface.removeColumn('WebsiteDomains', 'cpanelAccount');
  },
};

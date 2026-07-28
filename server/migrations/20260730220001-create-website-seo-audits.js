'use strict';

/**
 * Phase 8 slice 5 (current-phase-plan.md § 2c). One row per audit run
 * — an audit trail, matching WebsiteDeployment's established per-
 * attempt convention. Employee-only.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteSeoAudits', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      websiteId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Websites', key: 'id' }, onDelete: 'CASCADE',
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      websiteVersionId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'WebsiteVersions', key: 'id' },
      },
      runByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      findings: {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteSeoAudits', ['agencyOrganizationId']);
    await queryInterface.addIndex('WebsiteSeoAudits', ['websiteId', 'createdAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsiteSeoAudits');
  },
};

'use strict';

/**
 * Phase 6 slice 6 (current-phase-plan.md § 2e). Employee-only — never
 * reachable by a client-membership request (mirroring ProjectFinancials'
 * assertEmployeeContext pattern), an explicit decision made up front
 * during the pre-implementation review rather than left undecided by
 * omission the way the original draft left it. `environment` defaults
 * to 'preview' this slice; Phase 7 is expected to widen `status` and
 * add backup/health-check fields via a follow-on migration rather than
 * introducing a second, competing deployment-history table.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteDeployments', {
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
      developmentHandoffId: { type: Sequelize.UUID, allowNull: true },
      environment: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'preview',
      },
      branchName: { type: Sequelize.STRING(255), allowNull: false },
      commitSha: { type: Sequelize.STRING(255), allowNull: true },
      previewUrl: { type: Sequelize.STRING(500), allowNull: true },
      status: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending',
      },
      deployedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteDeployments', ['websiteId']);
    await queryInterface.addIndex('WebsiteDeployments', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsiteDeployments');
  },
};

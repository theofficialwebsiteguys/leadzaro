'use strict';

/**
 * Phase 6 slice 7 (current-phase-plan.md § 2e). Employee-only, same
 * reasoning and same pattern as WebsiteDeployment (slice 6).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteDevelopmentHandoffs', {
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
      branchName: { type: Sequelize.STRING(255), allowNull: false },
      technicalHandoffNotes: { type: Sequelize.TEXT, allowNull: true },
      status: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'initiated',
      },
      initiatedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteDevelopmentHandoffs', ['websiteId']);
    await queryInterface.addIndex('WebsiteDevelopmentHandoffs', ['agencyOrganizationId']);

    // WebsiteDeployment.developmentHandoffId (added in slice 6, nullable
    // until this table existed to reference) — added here, its natural
    // home, rather than retroactively editing slice 6's own migration.
    await queryInterface.addConstraint('WebsiteDeployments', {
      fields: ['developmentHandoffId'],
      type: 'foreign key',
      name: 'website_deployments_development_handoff_id_fkey',
      references: { table: 'WebsiteDevelopmentHandoffs', field: 'id' },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('WebsiteDeployments', 'website_deployments_development_handoff_id_fkey');
    await queryInterface.dropTable('WebsiteDevelopmentHandoffs');
  },
};

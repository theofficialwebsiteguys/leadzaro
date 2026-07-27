'use strict';

/**
 * Phase 6 slice 1 (current-phase-plan.md § 2b). One row per Website,
 * created lazily via findOrCreateWebsiteRepositoryForRequester on first
 * real need (§ 2b's correction — never eagerly at Website creation,
 * both to avoid a backfill migration for pre-existing websites and to
 * avoid provisioning a real external repo for a website that stays in
 * blank-draft-only editing forever).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteRepositories', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      websiteId: {
        type: Sequelize.UUID, allowNull: false, unique: true, references: { model: 'Websites', key: 'id' }, onDelete: 'CASCADE',
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      provider: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'github',
      },
      externalRepoId: { type: Sequelize.STRING(255), allowNull: true },
      fullName: { type: Sequelize.STRING(255), allowNull: true },
      defaultBranch: {
        type: Sequelize.STRING(100), allowNull: false, defaultValue: 'main',
      },
      status: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'provisioning',
      },
      createdByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteRepositories', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsiteRepositories');
  },
};

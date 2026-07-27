'use strict';

/**
 * Phase 5 slice 1 (docs/leadzaro/current-phase-plan.md § 2a/2b/2c). A
 * Website belongs to a Project 1:1 (unique index on projectId — a
 * documented scope boundary, see current-phase-plan.md § 2b). Every
 * table denormalizes organizationId/agencyOrganizationId directly,
 * matching the established Task/Message/Meeting pattern and the
 * correction Phase 4's own mid-phase review already had to make once
 * for Meeting.
 *
 * DesignSystem.organizationId is nullable: a library-template row has
 * organizationId: null and is only ever visible to employees (browsing
 * to start a new client site); a client's own forked instance has both
 * organizationId and agencyOrganizationId set, exactly like Project.
 *
 * WebsiteVersion.status starts at 'draft' for every row created this
 * slice — the pending_review/approved/published workflow depends on
 * the per-property editing-level classification built in slice 3, not
 * yet in place here.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DesignSystems', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Organizations', key: 'id' },
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Organizations', key: 'id' },
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      tokens: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      isLibraryTemplate: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      forkedFromDesignSystemId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'DesignSystems', key: 'id' },
      },
      createdByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('DesignSystems', ['agencyOrganizationId']);
    await queryInterface.addIndex('DesignSystems', ['organizationId']);

    await queryInterface.createTable('Websites', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      projectId: {
        type: Sequelize.UUID, allowNull: false, unique: true, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      designSystemId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'DesignSystems', key: 'id' },
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      startingMode: { type: Sequelize.STRING(20), allowNull: false },
      draftSchema: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      currentPublishedVersionId: { type: Sequelize.UUID, allowNull: true },
      createdByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Websites', ['agencyOrganizationId']);

    await queryInterface.createTable('WebsiteVersions', {
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
      versionNumber: { type: Sequelize.INTEGER, allowNull: false },
      label: { type: Sequelize.STRING(150), allowNull: true },
      schema: { type: Sequelize.JSONB, allowNull: false },
      isAutosave: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      status: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'draft',
      },
      createdByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      publishedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteVersions', ['websiteId']);
    await queryInterface.addIndex('WebsiteVersions', ['agencyOrganizationId']);
    await queryInterface.addConstraint('WebsiteVersions', {
      fields: ['websiteId', 'versionNumber'],
      type: 'unique',
      name: 'website_versions_website_id_version_number_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsiteVersions');
    await queryInterface.dropTable('Websites');
    await queryInterface.dropTable('DesignSystems');
  },
};

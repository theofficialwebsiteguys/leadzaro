'use strict';

/**
 * Phase 7 slice 6 (current-phase-plan.md § 2e). Keeps the anonymous-
 * write surface separate from the trusted internal ClientRequest queue
 * (review finding #2) — an employee explicitly triages a pending row
 * and either discards it or promotes it into a real ClientRequest,
 * rather than anonymous, unverified submissions landing directly in
 * the same queue authenticated org members' requests already occupy.
 * Employee-only visibility, same as WebsiteDeployment/WebsiteDomain.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsitePublicFormSubmissions', {
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
      pageId: { type: Sequelize.STRING(255), allowNull: false },
      sectionId: { type: Sequelize.STRING(255), allowNull: false },
      values: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending_review',
      },
      convertedToClientRequestId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'ClientRequests', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsitePublicFormSubmissions', ['agencyOrganizationId']);
    await queryInterface.addIndex('WebsitePublicFormSubmissions', ['websiteId', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsitePublicFormSubmissions');
  },
};

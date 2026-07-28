'use strict';

/**
 * Phase 8 slice 3 (current-phase-plan.md § 2c). Employee-only
 * (builder.manage) — redirects are a technical/structural concern
 * (like domain/document-root mapping), not a content-editing one a
 * client would typically manage directly. One fromPath per website
 * (unique index) — a second redirect for the same source path would
 * be ambiguous.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteRedirects', {
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
      fromPath: { type: Sequelize.STRING(500), allowNull: false },
      toPath: { type: Sequelize.STRING(500), allowNull: false },
      statusCode: {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 301,
      },
      createdByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteRedirects', ['agencyOrganizationId']);
    await queryInterface.addIndex('WebsiteRedirects', ['websiteId', 'fromPath'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsiteRedirects');
  },
};

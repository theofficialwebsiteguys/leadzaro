'use strict';

/**
 * Phase 8 slice 2 (current-phase-plan.md § 2b). Kept separate from
 * WebsiteVersion.schema (current, mutable operational data, not
 * versioned design content) — one row per page, upserted in place,
 * never versioned. Employee-visible via builder.manage; client-
 * editable via builder.edit (already scoped to the right client roles
 * — client_owner/marketing/content_editor — see catalog.js's
 * BUILDER_EDIT_CLIENT_ROLE_KEYS), both additionally gated by
 * assertSeoEntitlement.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsitePageSeoSettings', {
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
      pageId: { type: Sequelize.STRING(255), allowNull: false },
      metaTitle: { type: Sequelize.STRING(255), allowNull: true },
      metaDescription: { type: Sequelize.STRING(500), allowNull: true },
      canonicalUrl: { type: Sequelize.STRING(500), allowNull: true },
      robotsDirective: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'index,follow',
      },
      schemaJson: { type: Sequelize.JSONB, allowNull: true },
      updatedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsitePageSeoSettings', ['agencyOrganizationId']);
    await queryInterface.addIndex('WebsitePageSeoSettings', ['websiteId', 'pageId'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsitePageSeoSettings');
  },
};

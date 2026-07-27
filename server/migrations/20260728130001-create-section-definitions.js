'use strict';

/**
 * Phase 5 slice 2 (current-phase-plan.md § 2d). Agency-scoped, not a
 * single global catalog — the phase's own "library governance" outcome
 * implies agencies curate their own section libraries.
 * agencyOrganizationId: null rows are platform-provided defaults
 * visible to everyone; non-null rows are a specific agency's own
 * custom/registered components.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SectionDefinitions', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Organizations', key: 'id' },
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      componentKey: { type: Sequelize.STRING(60), allowNull: false },
      category: { type: Sequelize.STRING(60), allowNull: false },
      settingsSchema: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      variants: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      state: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'managed' },
      previewImageUrl: { type: Sequelize.STRING(500), allowNull: true },
      isSystemDefined: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('SectionDefinitions', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('SectionDefinitions');
  },
};

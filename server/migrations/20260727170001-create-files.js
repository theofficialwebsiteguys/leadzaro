'use strict';

/**
 * Phase 4 slice 6 (current-phase-plan.md § 5 item 6, § 2b correction 2).
 * Client visibility for File is deliberately NOT just `isPrivate = false`
 * — the independent review found that rule alone would make e.g. a
 * non-private website_asset file client-visible with no check tying it
 * to any specific client-visible context. The real rule (enforced in
 * clientVisibleModels.js, not here): isPrivate = false AND scope is in
 * an explicit client-facing allowlist, and for task_attachment/
 * message_attachment specifically, the referenced Task/Message itself
 * must independently be client-visible (checked via a real lookup, per
 * ADR 0007 — never via an `include` of the guarded Task/Message models).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Files', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      projectId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
      },
      uploadedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      scope: { type: Sequelize.STRING(30), allowNull: false },
      // Polymorphic: a Task/Message/ClientRequest/Meeting id, depending
      // on `scope`. Null for organization/project/website_asset scopes.
      relatedId: { type: Sequelize.UUID, allowNull: true },
      storageKey: { type: Sequelize.STRING(500), allowNull: false },
      originalName: { type: Sequelize.STRING(255), allowNull: false },
      mimeType: { type: Sequelize.STRING(100), allowNull: false },
      sizeBytes: { type: Sequelize.INTEGER, allowNull: false },
      isPrivate: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Files', ['projectId']);
    await queryInterface.addIndex('Files', ['agencyOrganizationId']);
    await queryInterface.addIndex('Files', ['organizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Files');
  },
};

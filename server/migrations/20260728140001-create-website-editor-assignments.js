'use strict';

/**
 * Phase 5 slice 3 (current-phase-plan.md § 2g). A new table, not an
 * editingLevel field bolted onto ProjectAssignment — ProjectAssignment's
 * unique key is (projectId, userId, roleSlot), so a single user can
 * hold multiple role-slot rows on one project with no principled single
 * answer for "this user's editing level" if it lived there. Unique on
 * (websiteId, userId): exactly one editing level per user per site.
 *
 * Also adds Website.draftHasPendingReviewChanges: set true whenever a
 * draft save includes a property/structural change flagged
 * requiresReview (§ 2e); createCheckpoint reads it to decide the new
 * version's status, then clears it — a single source of truth instead
 * of duplicating the review-classification logic in two places.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteEditorAssignments', {
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
      userId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      editingLevel: { type: Sequelize.STRING(20), allowNull: false },
      assignedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteEditorAssignments', ['websiteId']);
    await queryInterface.addIndex('WebsiteEditorAssignments', ['agencyOrganizationId']);
    await queryInterface.addConstraint('WebsiteEditorAssignments', {
      fields: ['websiteId', 'userId'],
      type: 'unique',
      name: 'website_editor_assignments_website_id_user_id_unique',
    });

    await queryInterface.addColumn('Websites', 'draftHasPendingReviewChanges', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Websites', 'draftHasPendingReviewChanges');
    await queryInterface.dropTable('WebsiteEditorAssignments');
  },
};

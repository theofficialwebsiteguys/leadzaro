'use strict';

/**
 * Supports prospect duplicate merging (Phase 2 roadmap: "duplicate
 * detection, merge preview, merge audit, restore/undo safety").
 * `mergedIntoOpportunityId` marks a merged-away ("loser") opportunity and
 * is the mechanism undo-merge uses to find its way back — merging never
 * hard-deletes, it archives + tags, matching every other soft-delete
 * lifecycle in this codebase.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Opportunities', 'mergedIntoOpportunityId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'Opportunities', key: 'id' },
    });
    await queryInterface.addIndex('Opportunities', ['mergedIntoOpportunityId']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Opportunities', ['mergedIntoOpportunityId']);
    await queryInterface.removeColumn('Opportunities', 'mergedIntoOpportunityId');
  },
};

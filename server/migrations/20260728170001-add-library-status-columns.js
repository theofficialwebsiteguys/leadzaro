'use strict';

/**
 * Phase 5 slice 8 (current-phase-plan.md § 2n) — library governance
 * ("curating/publishing/deprecating platform- or agency-level
 * DesignSystem/SectionDefinition templates") needs a lifecycle status
 * distinct from SectionDefinition.state (which describes Angular-
 * integration status per § 2d, not publish/deprecate governance).
 *
 * Default 'published' backfills every existing row (all system-seeded
 * SectionDefinitions and every already-forked client DesignSystem
 * instance) so nothing currently visible changes — the column is only
 * ever meaningful for isLibraryTemplate: true DesignSystem rows and for
 * SectionDefinitions being offered for new use; a client's own forked
 * DesignSystem instance simply never has its status read.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('SectionDefinitions', 'status', {
      type: Sequelize.STRING(20), allowNull: false, defaultValue: 'published',
    });
    await queryInterface.addColumn('DesignSystems', 'status', {
      type: Sequelize.STRING(20), allowNull: false, defaultValue: 'published',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('SectionDefinitions', 'status');
    await queryInterface.removeColumn('DesignSystems', 'status');
  },
};

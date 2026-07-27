'use strict';

/**
 * Phase 5 slice 5 (current-phase-plan.md § 2l). Image uploads get a
 * small set of resized variants alongside the original — never
 * discarding it, per architecture § 13's "preserve originals and
 * create optimized responsive variants without requiring a paid
 * image-transformation service." variants is nullable/empty for
 * non-image files.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Files', 'variants', {
      type: Sequelize.JSONB, allowNull: false, defaultValue: {},
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Files', 'variants');
  },
};

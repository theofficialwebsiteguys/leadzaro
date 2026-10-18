'use strict';

/**
 * Social profiles found while qualifying (ADR 0016): Instagram, LinkedIn,
 * TikTok and the like, beside the existing Facebook link. A list of
 * { platform, url } so a business can have any number of them.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Organizations', 'socialLinks', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Organizations', 'socialLinks');
  },
};

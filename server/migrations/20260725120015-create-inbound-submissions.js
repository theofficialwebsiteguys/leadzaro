'use strict';

/**
 * Public acquisition (Phase 2 roadmap § 20): records which landing page,
 * UTM parameters, ad campaign, and requested service produced a given
 * Opportunity, so source attribution survives independently of the
 * Opportunity/Contact/Organization rows it's attached to.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('InboundSubmissions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      opportunityId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'Opportunities', key: 'id' },
        onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
      },
      landingPageSlug: { type: Sequelize.STRING(60), allowNull: false },
      requestedService: { type: Sequelize.STRING(60), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: true },
      utmSource: { type: Sequelize.STRING(150), allowNull: true },
      utmMedium: { type: Sequelize.STRING(150), allowNull: true },
      utmCampaign: { type: Sequelize.STRING(150), allowNull: true },
      utmTerm: { type: Sequelize.STRING(150), allowNull: true },
      utmContent: { type: Sequelize.STRING(150), allowNull: true },
      referrer: { type: Sequelize.STRING(500), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('InboundSubmissions', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('InboundSubmissions');
  },
};

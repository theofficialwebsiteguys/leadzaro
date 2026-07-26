'use strict';

/**
 * Enrichment results (Phase 2 roadmap: "manual/optional enrichment
 * adapter"). One per opportunity, regenerated in place — same pattern
 * as WebsiteAudits. No real provider exists yet; `provider`/`status`
 * record which adapter actually produced this result so a mock result
 * is never confused with a real one.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Enrichments', {
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
      provider: { type: Sequelize.STRING(40), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false },
      data: { type: Sequelize.JSONB, allowNull: true },
      requestedByUserId: { type: Sequelize.UUID, allowNull: false },
      requestedAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Enrichments', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Enrichments');
  },
};

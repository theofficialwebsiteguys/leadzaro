'use strict';

/**
 * Research claims (ADR 0016 revision). Qualifying a search result no longer
 * creates a lead until the qualification is complete; while someone works
 * through it, a claim on the Google listing tells teammates it's being
 * researched. Claims are short-lived markers, not records of work.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, UUIDV4, STRING, DATE } = Sequelize;
    await queryInterface.createTable('ResearchClaims', {
      id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
      agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
      googlePlaceId: { type: STRING(255), allowNull: false },
      businessName: { type: STRING(255), allowNull: true },
      userId: { type: UUID, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' },
      createdAt: { type: DATE, allowNull: false },
      updatedAt: { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('ResearchClaims', ['agencyOrganizationId', 'googlePlaceId'], { unique: true, name: 'research_claims_agency_place_unique' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ResearchClaims');
  },
};

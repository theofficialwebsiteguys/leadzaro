'use strict';

/**
 * Website audits (Phase 2 roadmap: "Website audits + shareable report").
 * One audit per Opportunity (regenerating updates the same row in place
 * so a previously-shared link keeps working rather than breaking).
 * `shareTokenHash` follows the same hashed-at-rest pattern as
 * Invitations/PasswordResetTokens (see server/core/security/tokens.js) —
 * the raw token is only ever returned once, to embed in the shareable
 * link; only its SHA-256 hash is persisted.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteAudits', {
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
      score: { type: Sequelize.INTEGER, allowNull: false },
      summary: { type: Sequelize.TEXT, allowNull: false },
      checks: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      shareTokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      generatedByUserId: { type: Sequelize.UUID, allowNull: false },
      generatedAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteAudits', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsiteAudits');
  },
};

'use strict';

/**
 * Phase 7 slice 1 (current-phase-plan.md § 2d). One row per Website,
 * employee-only (assertEmployeeContextForDomain) — registrar/DNS
 * internals are sensitive and expiresAt/autoRenew are billing-adjacent,
 * decided explicitly during the pre-implementation review rather than
 * left as a partial-field client-visibility branch (finding #8).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteDomains', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      websiteId: {
        type: Sequelize.UUID, allowNull: false, unique: true, references: { model: 'Websites', key: 'id' }, onDelete: 'CASCADE',
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      provider: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'namecheap',
      },
      domain: { type: Sequelize.STRING(255), allowNull: false },
      externalDomainId: { type: Sequelize.STRING(255), allowNull: true },
      status: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending',
      },
      registeredAt: { type: Sequelize.DATE, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      autoRenew: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      dnsRecords: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      createdByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteDomains', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsiteDomains');
  },
};

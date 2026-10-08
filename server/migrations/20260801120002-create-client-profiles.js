'use strict';

/**
 * One agency-only profile row per client Organization (see ADR 0008):
 * the manually-maintained "client binder" — identity, website/hosting,
 * and billing facts. Every field is nullable and individually typed so
 * a manual form, a future onboarding form, or a future Stripe sync can
 * each fill in exactly the fields they know about.
 *
 * Deliberately never holds secrets: no password columns, no card/bank
 * numbers. `accessNotes` is for *where* credentials live (e.g. "in the
 * team password manager under Haven Fit"), not the credentials.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ClientProfiles', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, unique: true, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },

      description: { type: Sequelize.TEXT, allowNull: true },
      logoFileId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Files', key: 'id' }, onDelete: 'SET NULL',
      },
      featuredImageFileId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Files', key: 'id' }, onDelete: 'SET NULL',
      },
      addressLine1: { type: Sequelize.STRING(200), allowNull: true },
      addressLine2: { type: Sequelize.STRING(200), allowNull: true },
      city: { type: Sequelize.STRING(100), allowNull: true },
      state: { type: Sequelize.STRING(100), allowNull: true },
      postalCode: { type: Sequelize.STRING(20), allowNull: true },
      country: { type: Sequelize.STRING(100), allowNull: true },
      internalNotes: { type: Sequelize.TEXT, allowNull: true },

      websiteUrl: { type: Sequelize.STRING(500), allowNull: true },
      domainName: { type: Sequelize.STRING(255), allowNull: true },
      registrar: { type: Sequelize.STRING(150), allowNull: true },
      hostingProvider: { type: Sequelize.STRING(150), allowNull: true },
      domainRenewalDate: { type: Sequelize.DATEONLY, allowNull: true },
      hostingRenewalDate: { type: Sequelize.DATEONLY, allowNull: true },
      adminLinks: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      accessNotes: { type: Sequelize.TEXT, allowNull: true },

      setupPriceCents: { type: Sequelize.INTEGER, allowNull: true },
      recurringPriceCents: { type: Sequelize.INTEGER, allowNull: true },
      billingFrequency: { type: Sequelize.STRING(20), allowNull: true },
      paymentStatus: { type: Sequelize.STRING(20), allowNull: true },
      billingLinks: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      billingNotes: { type: Sequelize.TEXT, allowNull: true },
      internalMonthlyCostCents: { type: Sequelize.INTEGER, allowNull: true },
      internalCostNotes: { type: Sequelize.TEXT, allowNull: true },

      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ClientProfiles', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ClientProfiles');
  },
};

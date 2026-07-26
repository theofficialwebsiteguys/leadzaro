'use strict';

/**
 * Phase 3 (roadmap: "Stripe Billing and Client Conversion"). See
 * docs/leadzaro/current-phase-plan.md for the full design, corrected by
 * an independent architecture review before this migration was written.
 *
 * The partial unique index on ConversionAttempts(opportunityId) WHERE
 * status = 'completed' is the database-level backstop behind
 * conversionService's row lock — it is what actually guarantees the
 * phase's major gate ("the same Stripe event must never create
 * duplicate clients, projects, subscriptions, or invitations") even if
 * the lock is ever bypassed or a future code path forgets it.
 * opportunityId is nullable (a payment event whose Stripe metadata
 * can't be resolved to an Opportunity is a real, handled case — see
 * ConversionAttempt.status = 'needs_attention'); multiple NULL rows
 * never violate a unique index under standard SQL NULL semantics, which
 * is exactly the desired behavior here.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ServicePlans', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      key: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(150), allowNull: false },
      priceType: { type: Sequelize.STRING(20), allowNull: false },
      amountCents: { type: Sequelize.INTEGER, allowNull: false },
      billingInterval: { type: Sequelize.STRING(20), allowNull: true },
      stripeProductId: { type: Sequelize.STRING(255), allowNull: true },
      stripePriceId: { type: Sequelize.STRING(255), allowNull: true },
      isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('WebhookEvents', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      stripeEventId: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      eventType: { type: Sequelize.STRING(100), allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'received' },
      errorMessage: { type: Sequelize.TEXT, allowNull: true },
      processedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('PaymentLinkRequests', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      opportunityId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Opportunities', key: 'id' }, onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      servicePlanId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'ServicePlans', key: 'id' },
      },
      addOnServicePlanIds: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      stripePaymentLinkId: { type: Sequelize.STRING(255), allowNull: true },
      stripePaymentLinkUrl: { type: Sequelize.STRING(500), allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'created' },
      createdByUserId: { type: Sequelize.UUID, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('PaymentLinkRequests', ['agencyOrganizationId']);
    await queryInterface.addIndex('PaymentLinkRequests', ['opportunityId']);

    await queryInterface.createTable('ConversionAttempts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      opportunityId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Opportunities', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Organizations', key: 'id' },
      },
      source: { type: Sequelize.STRING(20), allowNull: false },
      webhookEventId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'WebhookEvents', key: 'id' },
      },
      status: { type: Sequelize.STRING(20), allowNull: false },
      failureReason: { type: Sequelize.TEXT, allowNull: true },
      resultingClientOrganizationId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Organizations', key: 'id' },
      },
      projectSetupPending: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdByUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ConversionAttempts', ['agencyOrganizationId']);
    await queryInterface.addIndex('ConversionAttempts', ['opportunityId', 'status'], {
      unique: true,
      where: { status: 'completed' },
      name: 'conversion_attempts_opportunity_completed_unique',
    });

    await queryInterface.createTable('BillingAccounts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, unique: true, references: { model: 'Organizations', key: 'id' },
      },
      stripeCustomerId: { type: Sequelize.STRING(255), allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('Subscriptions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      billingAccountId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'BillingAccounts', key: 'id' }, onDelete: 'CASCADE',
      },
      servicePlanId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'ServicePlans', key: 'id' },
      },
      stripeSubscriptionId: { type: Sequelize.STRING(255), allowNull: true, unique: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' },
      currentPeriodStart: { type: Sequelize.DATE, allowNull: true },
      currentPeriodEnd: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Subscriptions', ['billingAccountId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Subscriptions');
    await queryInterface.dropTable('BillingAccounts');
    await queryInterface.dropTable('ConversionAttempts');
    await queryInterface.dropTable('PaymentLinkRequests');
    await queryInterface.dropTable('WebhookEvents');
    await queryInterface.dropTable('ServicePlans');
  },
};

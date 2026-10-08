const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PaymentLinkRequest = sequelize.define('PaymentLinkRequest', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    opportunityId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // See Opportunity.js for why this is denormalized rather than
    // resolved via a join through the prospect organization.
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    servicePlanId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    addOnServicePlanIds: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    stripePaymentLinkId: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    stripePaymentLinkUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'created',
    },
    createdByUserId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // ADR 0011: kind 'payment_link' (shareable) or 'checkout_session'
    // (bound to a Stripe customer, expires). Link, payment and subscription
    // statuses are tracked separately; attributedUserId is fixed at creation.
    kind: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'payment_link' },
    stripeMode: { type: DataTypes.STRING(10), allowNull: true },
    stripeAccountId: { type: DataTypes.STRING(100), allowNull: true },
    stripeCheckoutSessionId: { type: DataTypes.STRING(255), allowNull: true },
    stripeCustomerId: { type: DataTypes.STRING(255), allowNull: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    currency: { type: DataTypes.STRING(3), allowNull: true },
    initialAmountCents: { type: DataTypes.INTEGER, allowNull: true },
    recurringAmountCents: { type: DataTypes.INTEGER, allowNull: true },
    recurringInterval: { type: DataTypes.STRING(10), allowNull: true },
    lineItems: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    offerTitle: { type: DataTypes.STRING(200), allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: true, unique: true },
    attributedUserId: { type: DataTypes.UUID, allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    sentVia: { type: DataTypes.STRING(20), allowNull: true },
    sentByUserId: { type: DataTypes.UUID, allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    amountPaidCents: { type: DataTypes.INTEGER, allowNull: true },
    stripeSubscriptionId: { type: DataTypes.STRING(255), allowNull: true },
    stripeInvoiceId: { type: DataTypes.STRING(255), allowNull: true },
    stripePaymentIntentId: { type: DataTypes.STRING(255), allowNull: true },
    deactivatedAt: { type: DataTypes.DATE, allowNull: true },
    deactivatedByUserId: { type: DataTypes.UUID, allowNull: true },
    lastError: { type: DataTypes.STRING(500), allowNull: true },
    replacedByRequestId: { type: DataTypes.UUID, allowNull: true },
  });

  PaymentLinkRequest.associate = (models) => {
    PaymentLinkRequest.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
    PaymentLinkRequest.belongsTo(models.ServicePlan, { foreignKey: 'servicePlanId', as: 'servicePlan' });
    PaymentLinkRequest.belongsTo(models.User, { foreignKey: 'attributedUserId', as: 'attributedTo' });
    PaymentLinkRequest.belongsTo(models.User, { foreignKey: 'createdByUserId', as: 'createdBy' });
  };

  return PaymentLinkRequest;
};

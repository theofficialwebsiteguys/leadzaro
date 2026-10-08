const { DataTypes } = require('sequelize');

// A payment actually received. source 'stripe' rows are written only from
// verified webhooks or a Stripe refresh; source 'manual' rows are
// authorized, audited entries (check, cash, bank transfer). kind 'initial'
// is the sale; 'renewal' is recurring revenue and never counts as a new sale.
module.exports = (sequelize) => {
  const SalesPayment = sequelize.define('SalesPayment', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    opportunityId: { type: DataTypes.UUID, allowNull: true },
    paymentLinkRequestId: { type: DataTypes.UUID, allowNull: true },
    source: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [['stripe', 'manual']] } },
    kind: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [['initial', 'renewal', 'other']] } },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'succeeded' },
    amountCents: { type: DataTypes.INTEGER, allowNull: false },
    amountRefundedCents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(3), allowNull: false },
    paidAt: { type: DataTypes.DATE, allowNull: false },
    stripeMode: { type: DataTypes.STRING(10), allowNull: true },
    stripeCustomerId: { type: DataTypes.STRING(255), allowNull: true },
    stripeCheckoutSessionId: { type: DataTypes.STRING(255), allowNull: true },
    stripePaymentIntentId: { type: DataTypes.STRING(255), allowNull: true },
    stripeInvoiceId: { type: DataTypes.STRING(255), allowNull: true },
    stripeSubscriptionId: { type: DataTypes.STRING(255), allowNull: true },
    stripeChargeId: { type: DataTypes.STRING(255), allowNull: true },
    receiptUrl: { type: DataTypes.STRING(500), allowNull: true },
    invoiceUrl: { type: DataTypes.STRING(500), allowNull: true },
    attributedUserId: { type: DataTypes.UUID, allowNull: true },
    recordedByUserId: { type: DataTypes.UUID, allowNull: true },
    method: { type: DataTypes.STRING(30), allowNull: true },
    reference: { type: DataTypes.STRING(200), allowNull: true },
    note: { type: DataTypes.TEXT, allowNull: true },
  });

  SalesPayment.associate = (models) => {
    SalesPayment.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
    SalesPayment.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    SalesPayment.belongsTo(models.PaymentLinkRequest, { foreignKey: 'paymentLinkRequestId', as: 'paymentLinkRequest' });
    SalesPayment.belongsTo(models.User, { foreignKey: 'attributedUserId', as: 'attributedTo' });
    SalesPayment.belongsTo(models.User, { foreignKey: 'recordedByUserId', as: 'recordedBy' });
  };

  return SalesPayment;
};

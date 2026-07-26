const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  // Deliberately named/kept separate from the legacy UserSubscription
  // model (a user-owned, enum-planned, self-serve public-SaaS model
  // predating the agency-operations pivot) — this is the organization-
  // owned, service-catalog-driven client billing model described in the
  // master architecture's "Client and project domain". Do not merge
  // these two; see docs/leadzaro/current-phase-plan.md.
  const Subscription = sequelize.define('Subscription', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    billingAccountId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    servicePlanId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    stripeSubscriptionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
    },
    currentPeriodStart: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    currentPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  Subscription.associate = (models) => {
    Subscription.belongsTo(models.BillingAccount, { foreignKey: 'billingAccountId', as: 'billingAccount' });
    Subscription.belongsTo(models.ServicePlan, { foreignKey: 'servicePlanId', as: 'servicePlan' });
  };

  return Subscription;
};

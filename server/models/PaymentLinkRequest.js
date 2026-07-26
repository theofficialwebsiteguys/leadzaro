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
      allowNull: false,
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
  });

  PaymentLinkRequest.associate = (models) => {
    PaymentLinkRequest.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
    PaymentLinkRequest.belongsTo(models.ServicePlan, { foreignKey: 'servicePlanId', as: 'servicePlan' });
  };

  return PaymentLinkRequest;
};

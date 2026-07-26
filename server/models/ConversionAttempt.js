const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ConversionAttempt = sequelize.define('ConversionAttempt', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Nullable: a payment-completed event whose Stripe metadata can't be
    // resolved to an Opportunity (Dashboard-created invoice, a portal
    // action with no Payment Link behind it, missing metadata) is a
    // real, handled input — recorded here as status: 'needs_attention'
    // rather than silently no-op'd or thrown as an unhandled error.
    opportunityId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    webhookEventId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    resultingClientOrganizationId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    projectSetupPending: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    createdByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  });

  ConversionAttempt.associate = (models) => {
    ConversionAttempt.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
    ConversionAttempt.belongsTo(models.WebhookEvent, { foreignKey: 'webhookEventId', as: 'webhookEvent' });
    ConversionAttempt.belongsTo(models.Organization, { foreignKey: 'resultingClientOrganizationId', as: 'resultingClientOrganization' });
  };

  return ConversionAttempt;
};

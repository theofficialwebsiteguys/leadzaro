const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const InboundSubmission = sequelize.define('InboundSubmission', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    opportunityId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    // See Opportunity.js for why this is denormalized rather than
    // resolved via a join through the prospect organization.
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    landingPageSlug: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    requestedService: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    utmSource: { type: DataTypes.STRING(150), allowNull: true },
    utmMedium: { type: DataTypes.STRING(150), allowNull: true },
    utmCampaign: { type: DataTypes.STRING(150), allowNull: true },
    utmTerm: { type: DataTypes.STRING(150), allowNull: true },
    utmContent: { type: DataTypes.STRING(150), allowNull: true },
    referrer: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  });

  InboundSubmission.associate = (models) => {
    InboundSubmission.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
  };

  return InboundSubmission;
};

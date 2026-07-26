const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Enrichment = sequelize.define('Enrichment', {
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
    provider: {
      type: DataTypes.STRING(40),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    data: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    requestedByUserId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    requestedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });

  Enrichment.associate = (models) => {
    Enrichment.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
  };

  return Enrichment;
};

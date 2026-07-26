const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const WebsiteAudit = sequelize.define('WebsiteAudit', {
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
    score: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    checks: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    // Hashed at rest, same pattern as Invitation.tokenHash — the raw
    // token is only ever returned once, to embed in the shareable link.
    shareTokenHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    generatedByUserId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    generatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });

  WebsiteAudit.associate = (models) => {
    WebsiteAudit.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
  };

  return WebsiteAudit;
};

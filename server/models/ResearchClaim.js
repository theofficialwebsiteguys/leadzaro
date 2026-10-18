const { DataTypes } = require('sequelize');

// "Someone is researching this listing" (ADR 0016): a short-lived marker
// shown in search results while a qualification is in progress. Not a lead.
module.exports = (sequelize) => {
  const ResearchClaim = sequelize.define('ResearchClaim', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    googlePlaceId: { type: DataTypes.STRING(255), allowNull: false },
    businessName: { type: DataTypes.STRING(255), allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: false },
  });

  ResearchClaim.associate = (models) => {
    ResearchClaim.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return ResearchClaim;
};

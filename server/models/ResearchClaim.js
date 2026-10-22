const { DataTypes } = require('sequelize');

// "Someone is researching this listing" (ADR 0016): a short-lived marker
// shown in search results while a qualification is in progress, and the
// progress saved so far so it can be resumed (ADR 0017). Not a lead. The
// key is the Google listing id, or "manual:<id>" for a business added by hand.
module.exports = (sequelize) => {
  const ResearchClaim = sequelize.define('ResearchClaim', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    googlePlaceId: { type: DataTypes.STRING(255), allowNull: false },
    businessName: { type: DataTypes.STRING(255), allowNull: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    // Saved qualification progress (ADR 0017): what the search knew, and the steps so far.
    start: { type: DataTypes.JSONB, allowNull: true },
    draft: { type: DataTypes.JSONB, allowNull: true },
  });

  ResearchClaim.associate = (models) => {
    ResearchClaim.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return ResearchClaim;
};

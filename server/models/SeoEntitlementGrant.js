const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const SeoEntitlementGrant = sequelize.define('SeoEntitlementGrant', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    grantedByUserId: { type: DataTypes.UUID, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    revokedByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  SeoEntitlementGrant.associate = (models) => {
    SeoEntitlementGrant.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
  };

  installVisibilityGuard(SeoEntitlementGrant);

  return SeoEntitlementGrant;
};

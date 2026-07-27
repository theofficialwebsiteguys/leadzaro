const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const DesignSystem = sequelize.define('DesignSystem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: true },
    organizationId: { type: DataTypes.UUID, allowNull: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    tokens: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: {},
    },
    isLibraryTemplate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    forkedFromDesignSystemId: { type: DataTypes.UUID, allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  DesignSystem.associate = (models) => {
    DesignSystem.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    DesignSystem.belongsTo(models.User, { foreignKey: 'createdByUserId', as: 'createdBy' });
  };

  installVisibilityGuard(DesignSystem);

  return DesignSystem;
};

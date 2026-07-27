const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const WebsiteEditLock = sequelize.define('WebsiteEditLock', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    sectionKey: { type: DataTypes.STRING(255), allowNull: false },
    lockedByUserId: { type: DataTypes.UUID, allowNull: false },
    lockedAt: { type: DataTypes.DATE, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
  });

  WebsiteEditLock.associate = (models) => {
    WebsiteEditLock.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsiteEditLock.belongsTo(models.User, { foreignKey: 'lockedByUserId', as: 'lockedBy' });
  };

  installVisibilityGuard(WebsiteEditLock);

  return WebsiteEditLock;
};

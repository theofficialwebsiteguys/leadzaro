const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const WebsitePresence = sequelize.define('WebsitePresence', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    sectionKey: { type: DataTypes.STRING(255), allowNull: true },
    lastSeenAt: { type: DataTypes.DATE, allowNull: false },
  });

  WebsitePresence.associate = (models) => {
    WebsitePresence.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsitePresence.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  installVisibilityGuard(WebsitePresence);

  return WebsitePresence;
};

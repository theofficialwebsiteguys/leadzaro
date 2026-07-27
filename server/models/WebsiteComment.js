const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const WebsiteComment = sequelize.define('WebsiteComment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    versionId: { type: DataTypes.UUID, allowNull: true },
    anchorKey: { type: DataTypes.STRING(255), allowNull: false },
    authorUserId: { type: DataTypes.UUID, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    isInternal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    resolvedAt: { type: DataTypes.DATE, allowNull: true },
  });

  WebsiteComment.associate = (models) => {
    WebsiteComment.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsiteComment.belongsTo(models.User, { foreignKey: 'authorUserId', as: 'author' });
  };

  installVisibilityGuard(WebsiteComment);

  return WebsiteComment;
};

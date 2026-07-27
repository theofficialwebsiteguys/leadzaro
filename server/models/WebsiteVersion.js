const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['draft', 'pending_review', 'approved', 'published'];

module.exports = (sequelize) => {
  const WebsiteVersion = sequelize.define('WebsiteVersion', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    versionNumber: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING(150), allowNull: true },
    schema: { type: DataTypes.JSONB, allowNull: false },
    isAutosave: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft', validate: { isIn: [STATUSES] },
    },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
  });

  WebsiteVersion.STATUSES = STATUSES;

  WebsiteVersion.associate = (models) => {
    WebsiteVersion.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsiteVersion.belongsTo(models.User, { foreignKey: 'createdByUserId', as: 'createdBy' });
  };

  installVisibilityGuard(WebsiteVersion);

  return WebsiteVersion;
};

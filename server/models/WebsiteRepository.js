const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['provisioning', 'active', 'error'];

module.exports = (sequelize) => {
  const WebsiteRepository = sequelize.define('WebsiteRepository', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: {
      type: DataTypes.UUID, allowNull: false, unique: true,
    },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    provider: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'github',
    },
    externalRepoId: { type: DataTypes.STRING(255), allowNull: true },
    fullName: { type: DataTypes.STRING(255), allowNull: true },
    defaultBranch: {
      type: DataTypes.STRING(100), allowNull: false, defaultValue: 'main',
    },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'provisioning', validate: { isIn: [STATUSES] },
    },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  WebsiteRepository.STATUSES = STATUSES;

  WebsiteRepository.associate = (models) => {
    WebsiteRepository.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
  };

  installVisibilityGuard(WebsiteRepository);

  return WebsiteRepository;
};

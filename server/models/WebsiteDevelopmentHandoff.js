const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['initiated', 'preview_ready', 'in_development'];

module.exports = (sequelize) => {
  const WebsiteDevelopmentHandoff = sequelize.define('WebsiteDevelopmentHandoff', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    // The exact checkpoint being promoted — immutable, "preserve the
    // builder version" (architecture § 16) is satisfied simply by
    // referencing it, never copying or mutating it.
    websiteVersionId: { type: DataTypes.UUID, allowNull: false },
    branchName: { type: DataTypes.STRING(255), allowNull: false },
    technicalHandoffNotes: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'initiated', validate: { isIn: [STATUSES] },
    },
    initiatedByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  WebsiteDevelopmentHandoff.STATUSES = STATUSES;

  WebsiteDevelopmentHandoff.associate = (models) => {
    WebsiteDevelopmentHandoff.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsiteDevelopmentHandoff.belongsTo(models.WebsiteVersion, { foreignKey: 'websiteVersionId', as: 'websiteVersion' });
  };

  installVisibilityGuard(WebsiteDevelopmentHandoff);

  return WebsiteDevelopmentHandoff;
};

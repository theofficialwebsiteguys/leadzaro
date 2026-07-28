const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const WebsiteSeoAudit = sequelize.define('WebsiteSeoAudit', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    websiteVersionId: { type: DataTypes.UUID, allowNull: false },
    runByUserId: { type: DataTypes.UUID, allowNull: false },
    // One row per audit run — an audit trail, never updated in place,
    // matching WebsiteDeployment's established per-attempt convention.
    findings: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: [],
    },
  });

  WebsiteSeoAudit.associate = (models) => {
    WebsiteSeoAudit.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsiteSeoAudit.belongsTo(models.WebsiteVersion, { foreignKey: 'websiteVersionId', as: 'websiteVersion' });
  };

  installVisibilityGuard(WebsiteSeoAudit);

  return WebsiteSeoAudit;
};

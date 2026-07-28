const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const ENVIRONMENTS = ['preview', 'production'];
const STATUSES = ['pending', 'building', 'live', 'failed', 'rolled_back', 'rollback_failed'];

module.exports = (sequelize) => {
  const WebsiteDeployment = sequelize.define('WebsiteDeployment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    websiteVersionId: { type: DataTypes.UUID, allowNull: false },
    // Nullable this slice (only ever set once slice 7's promote-to-
    // development handoff exists) — a pure design-only preview deploy
    // has no handoff yet.
    developmentHandoffId: { type: DataTypes.UUID, allowNull: true },
    environment: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'preview', validate: { isIn: [ENVIRONMENTS] },
    },
    branchName: { type: DataTypes.STRING(255), allowNull: false },
    commitSha: { type: DataTypes.STRING(255), allowNull: true },
    previewUrl: { type: DataTypes.STRING(500), allowNull: true },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', validate: { isIn: [STATUSES] },
    },
    deployedByUserId: { type: DataTypes.UUID, allowNull: true },
    // Production only (current-phase-plan.md § 2b) — a snapshot of
    // Website.currentLiveProductionDeploymentId at the moment this
    // attempt started, so every attempt has an explicit, queryable
    // predecessor; and the cPanel adapter's own backup id for this
    // attempt. Both null for preview deploys, which never back up or
    // roll back.
    previousLiveDeploymentId: { type: DataTypes.UUID, allowNull: true },
    backupRef: { type: DataTypes.STRING(255), allowNull: true },
  });

  WebsiteDeployment.ENVIRONMENTS = ENVIRONMENTS;
  WebsiteDeployment.STATUSES = STATUSES;

  WebsiteDeployment.associate = (models) => {
    WebsiteDeployment.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsiteDeployment.belongsTo(models.WebsiteVersion, { foreignKey: 'websiteVersionId', as: 'websiteVersion' });
    WebsiteDeployment.belongsTo(models.WebsiteDeployment, { foreignKey: 'previousLiveDeploymentId', as: 'previousLiveDeployment' });
  };

  installVisibilityGuard(WebsiteDeployment);

  return WebsiteDeployment;
};

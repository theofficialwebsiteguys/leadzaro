const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STARTING_MODES = ['template', 'page_kit', 'guided', 'blank'];

module.exports = (sequelize) => {
  const Website = sequelize.define('Website', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: {
      type: DataTypes.UUID, allowNull: false, unique: true,
    },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    designSystemId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(150), allowNull: false },
    startingMode: {
      type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [STARTING_MODES] },
    },
    draftSchema: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: {},
    },
    currentPublishedVersionId: { type: DataTypes.UUID, allowNull: true },
    draftHasPendingReviewChanges: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Phase 7 (current-phase-plan.md § 2b) — which WebsiteDeployment is
    // actually serving live production hosting right now. A different
    // concept from currentPublishedVersionId (the design-review
    // "approved" pointer): this is set ONLY on a successful production
    // deploy and is never touched on a failed/rolled-back attempt, so
    // it always agrees with whatever build is genuinely live.
    currentLiveProductionDeploymentId: { type: DataTypes.UUID, allowNull: true },
    // Guided Google Analytics connection (current-phase-plan.md § 2d)
    // — Leadzaro never provisions a GA account; this only stores a
    // measurement ID the agency/client already has, employee-settable.
    googleAnalyticsMeasurementId: { type: DataTypes.STRING(50), allowNull: true },
    // Guided Google Search Console connection (current-phase-plan.md §
    // 2e) — same "store a value the agency/client already has, never
    // provision one" precedent as googleAnalyticsMeasurementId above.
    googleSearchConsolePropertyUrl: { type: DataTypes.STRING(500), allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  Website.STARTING_MODES = STARTING_MODES;

  Website.associate = (models) => {
    Website.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    Website.belongsTo(models.DesignSystem, { foreignKey: 'designSystemId', as: 'designSystem' });
  };

  installVisibilityGuard(Website);

  return Website;
};

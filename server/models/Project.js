const { DataTypes } = require('sequelize');
const { STAGES } = require('../core/projects/projectCatalog');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const HEALTH_STATUSES = ['on_track', 'at_risk', 'off_track'];
const PROJECT_TYPES = ['website', 'web_app', 'mobile_app', 'seo', 'branding', 'hosting', 'other'];

module.exports = (sequelize) => {
  const Project = sequelize.define('Project', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // The client Organization this project belongs to.
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Denormalized from Organization.managingAgencyOrganizationId at
    // creation time (never from ConversionAttempt — the Phase-1 demo
    // client has no ConversionAttempt at all; see the Phase-4-opening
    // backfill migration and current-phase-plan.md § 2a).
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ownerUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    stage: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: 'Client Onboarding',
      validate: { isIn: [STAGES] },
    },
    healthStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'on_track',
      validate: { isIn: [HEALTH_STATUSES] },
    },
    // Whether the current healthStatus was set by a human override or is
    // just the (currently: simple) suggested default — architecture § 10:
    // "suggested project health with manual override."
    healthStatusIsManualOverride: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    launchedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    cancellationRequestedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Links back to the Phase 3 conversion that created this client, when
    // one exists (the Phase-1 demo client predates Phase 3 and has none).
    sourceConversionAttemptId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Descriptive fields (ADR 0008 — a client can own several projects).
    // `name` is nullable: projects that predate multi-project clients
    // have none, and the UI falls back to the client's own name.
    name: { type: DataTypes.STRING(150), allowNull: true },
    projectType: { type: DataTypes.STRING(30), allowNull: true, validate: { isIn: [PROJECT_TYPES] } },
    description: { type: DataTypes.TEXT, allowNull: true },
    liveUrl: { type: DataTypes.STRING(500), allowNull: true },
    previewUrl: { type: DataTypes.STRING(500), allowNull: true },
    previewFileId: { type: DataTypes.UUID, allowNull: true },
    // [{ id, label, done }] — the lightweight "still needed" list shown on
    // the client hub. Deliberately not Tasks: these are outstanding
    // inputs (logo files, menu PDF, login access), not team work items.
    outstandingNeeds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  });

  Project.STAGES = STAGES;
  Project.HEALTH_STATUSES = HEALTH_STATUSES;
  Project.PROJECT_TYPES = PROJECT_TYPES;

  Project.associate = (models) => {
    Project.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    Project.belongsTo(models.User, { foreignKey: 'ownerUserId', as: 'owner' });
    Project.belongsTo(models.ConversionAttempt, { foreignKey: 'sourceConversionAttemptId', as: 'sourceConversionAttempt' });
    Project.hasMany(models.ProjectAssignment, { foreignKey: 'projectId', as: 'assignments' });
    Project.hasOne(models.ProjectFinancials, { foreignKey: 'projectId', as: 'financials' });
  };

  installVisibilityGuard(Project);

  return Project;
};

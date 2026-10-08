const { DataTypes } = require('sequelize');

const STATUSES = ['pending', 'needs_info', 'complete', 'failed'];

// The sale → client handoff (ADR 0011). One row per won opportunity;
// `failed` means payment succeeded but setting up the client did not, and
// the handoff can be retried. Missing details are onboarding items, never
// blockers.
module.exports = (sequelize) => {
  const SalesHandoff = sequelize.define('SalesHandoff', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    opportunityId: { type: DataTypes.UUID, allowNull: false, unique: true },
    clientOrganizationId: { type: DataTypes.UUID, allowNull: true },
    projectId: { type: DataTypes.UUID, allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', validate: { isIn: [STATUSES] } },
    data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    lastError: { type: DataTypes.TEXT, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    summaryNoteId: { type: DataTypes.UUID, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    completedByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  SalesHandoff.STATUSES = STATUSES;

  SalesHandoff.associate = (models) => {
    SalesHandoff.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
    SalesHandoff.belongsTo(models.Organization, { foreignKey: 'clientOrganizationId', as: 'clientOrganization' });
  };

  return SalesHandoff;
};

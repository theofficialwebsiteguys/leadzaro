const { DataTypes } = require('sequelize');

const WORK_TYPES = ['research', 'outreach', 'calls', 'meeting', 'onboarding', 'admin', 'other'];
const STATUSES = ['running', 'paused', 'stopped', 'abandoned'];
const REVIEW_STATUSES = ['unreviewed', 'approved', 'flagged'];

// Time an employee chose to record (ADR 0016): a timer they start, pause
// and stop, or a manual entry for work done outside the app. Corrections
// keep the original minutes and a reason. Never inferred from activity.
module.exports = (sequelize) => {
  const WorkSession = sequelize.define('WorkSession', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    opportunityId: { type: DataTypes.UUID, allowNull: true },
    workType: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [WORK_TYPES] } },
    source: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'timer', validate: { isIn: [['timer', 'manual']] } },
    status: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [STATUSES] } },
    startedAt: { type: DataTypes.DATE, allowNull: false },
    endedAt: { type: DataTypes.DATE, allowNull: true },
    pausedAt: { type: DataTypes.DATE, allowNull: true },
    pausedSeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    minutes: { type: DataTypes.INTEGER, allowNull: true },
    note: { type: DataTypes.STRING(1000), allowNull: true },
    originalMinutes: { type: DataTypes.INTEGER, allowNull: true },
    correctionReason: { type: DataTypes.STRING(500), allowNull: true },
    correctedByUserId: { type: DataTypes.UUID, allowNull: true },
    correctedAt: { type: DataTypes.DATE, allowNull: true },
    reviewStatus: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'unreviewed', validate: { isIn: [REVIEW_STATUSES] } },
    reviewedByUserId: { type: DataTypes.UUID, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
  });

  WorkSession.WORK_TYPES = WORK_TYPES;
  WorkSession.REVIEW_STATUSES = REVIEW_STATUSES;

  WorkSession.associate = (models) => {
    WorkSession.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    WorkSession.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
  };

  return WorkSession;
};

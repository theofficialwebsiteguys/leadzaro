const { DataTypes } = require('sequelize');

const KINDS = ['qualification'];
const STATUSES = ['pending', 'accepted', 'needs_correction', 'rejected', 'paid'];

// Credit for a completed piece of work, for compensation review (ADR 0016).
// One row per lead and kind; review state is separate from the lead's own
// workflow, so a pending review never holds up outreach.
module.exports = (sequelize) => {
  const WorkCredit = sequelize.define('WorkCredit', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    opportunityId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    kind: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [KINDS] } },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', validate: { isIn: [STATUSES] } },
    earnedAt: { type: DataTypes.DATE, allowNull: false },
    correctionCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastCorrectionReason: { type: DataTypes.STRING(500), allowNull: true },
    reviewNote: { type: DataTypes.STRING(500), allowNull: true },
    reviewedByUserId: { type: DataTypes.UUID, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    paidByUserId: { type: DataTypes.UUID, allowNull: true },
    // Context for the reviewer, e.g. research added to a lead already in Leadzaro (ADR 0017).
    note: { type: DataTypes.STRING(255), allowNull: true },
  });

  WorkCredit.KINDS = KINDS;
  WorkCredit.STATUSES = STATUSES;

  WorkCredit.associate = (models) => {
    WorkCredit.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
    WorkCredit.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    WorkCredit.belongsTo(models.User, { foreignKey: 'reviewedByUserId', as: 'reviewedBy' });
  };

  return WorkCredit;
};

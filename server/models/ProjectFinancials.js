const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

/**
 * Internal cost/profitability data, deliberately kept off the Project
 * row itself (ADR 0007 / current-phase-plan.md § 2b, correction 1): the
 * major gate names "financial margins" explicitly as something a client
 * must never see, and a boolean/flag can only protect a row, not a
 * field — Project rows themselves must be client-visible (stage/health/
 * owner). This table is never reachable by any client-facing route.
 */
module.exports = (sequelize) => {
  const ProjectFinancials = sequelize.define('ProjectFinancials', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    estimatedCostCents: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    actualCostCents: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    marginNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  ProjectFinancials.associate = (models) => {
    ProjectFinancials.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
  };

  installVisibilityGuard(ProjectFinancials);

  return ProjectFinancials;
};

const { DataTypes } = require('sequelize');

const METRICS = ['attempts', 'conversations', 'meetings', 'paid_sales'];

// Weekly personal targets. userId null is the team default that applies to
// anyone without their own target.
module.exports = (sequelize) => {
  const SalesGoal = sequelize.define('SalesGoal', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: true },
    metric: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [METRICS] } },
    period: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'week' },
    target: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0, max: 10000 } },
    updatedByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  SalesGoal.METRICS = METRICS;
  return SalesGoal;
};

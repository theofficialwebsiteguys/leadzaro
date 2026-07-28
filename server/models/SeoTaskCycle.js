const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const SeoTaskCycle = sequelize.define('SeoTaskCycle', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    // 'YYYY-MM' — one cycle per website per calendar month. A
    // database-level unique constraint (not just an app-level check)
    // on (websiteId, cyclePeriod) is what actually makes "generate
    // this cycle's tasks now" idempotent under concurrent triggers
    // (current-phase-plan.md § 2d review correction — a real
    // constraint, not check-then-create).
    cyclePeriod: { type: DataTypes.STRING(7), allowNull: false },
    generatedByUserId: { type: DataTypes.UUID, allowNull: false },
  }, {
    indexes: [{ unique: true, fields: ['websiteId', 'cyclePeriod'] }],
  });

  SeoTaskCycle.associate = (models) => {
    SeoTaskCycle.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
  };

  installVisibilityGuard(SeoTaskCycle);

  return SeoTaskCycle;
};

const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

// equal: split evenly across the plan's clients; manual: per-client amounts;
// none: agency overhead, charged to no client (ADR 0009).
const ALLOCATION_METHODS = ['equal', 'manual', 'none'];

module.exports = (sequelize) => {
  const HostingPlan = sequelize.define('HostingPlan', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(150), allowNull: false },
    providerName: { type: DataTypes.STRING(100), allowNull: true },
    planName: { type: DataTypes.STRING(100), allowNull: true },
    controlPanelUrl: { type: DataTypes.STRING(500), allowNull: true },
    costCents: { type: DataTypes.INTEGER, allowNull: true },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    billingPeriodMonths: { type: DataTypes.INTEGER, allowNull: true },
    expiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    nextChargeOn: { type: DataTypes.DATEONLY, allowNull: true },
    autoRenew: { type: DataTypes.BOOLEAN, allowNull: true },
    allocationMethod: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'equal', validate: { isIn: [ALLOCATION_METHODS] },
    },
    notes: { type: DataTypes.TEXT, allowNull: true },
    archivedAt: { type: DataTypes.DATE, allowNull: true },
    expiryNoticeLevel: { type: DataTypes.STRING(10), allowNull: true },
    expiryNoticeForDate: { type: DataTypes.DATEONLY, allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  HostingPlan.ALLOCATION_METHODS = ALLOCATION_METHODS;

  installVisibilityGuard(HostingPlan, { accessModule: 'server/core/domains/domainRegistryAccess.js' });

  return HostingPlan;
};

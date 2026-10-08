const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

/** An amount actually paid, entered by hand. Never derived from catalog prices (ADR 0009). */
module.exports = (sequelize) => {
  const ServiceExpense = sequelize.define('ServiceExpense', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    domainRecordId: { type: DataTypes.UUID, allowNull: true },
    hostingPlanId: { type: DataTypes.UUID, allowNull: true },
    amountCents: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 0 } },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    paidOn: { type: DataTypes.DATEONLY, allowNull: false },
    coversFrom: { type: DataTypes.DATEONLY, allowNull: true },
    coversTo: { type: DataTypes.DATEONLY, allowNull: true },
    description: { type: DataTypes.STRING(200), allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  installVisibilityGuard(ServiceExpense, { accessModule: 'server/core/domains/domainRegistryAccess.js' });

  return ServiceExpense;
};

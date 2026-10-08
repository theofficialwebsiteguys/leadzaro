const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const HostingPlanClient = sequelize.define('HostingPlanClient', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    hostingPlanId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    // The client's projects on this plan; empty means the client as a whole.
    projectIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    // Only used by the 'manual' allocation method; null = not allocated yet.
    allocatedCents: { type: DataTypes.INTEGER, allowNull: true },
  });

  installVisibilityGuard(HostingPlanClient, { accessModule: 'server/core/domains/domainRegistryAccess.js' });

  return HostingPlanClient;
};

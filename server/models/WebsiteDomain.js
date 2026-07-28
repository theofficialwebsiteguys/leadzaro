const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['pending', 'active', 'expired', 'transferring'];

module.exports = (sequelize) => {
  const WebsiteDomain = sequelize.define('WebsiteDomain', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: {
      type: DataTypes.UUID, allowNull: false, unique: true,
    },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    provider: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'namecheap',
    },
    domain: { type: DataTypes.STRING(255), allowNull: false },
    externalDomainId: { type: DataTypes.STRING(255), allowNull: true },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending', validate: { isIn: [STATUSES] },
    },
    registeredAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    autoRenew: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    dnsRecords: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    cpanelAccount: { type: DataTypes.STRING(255), allowNull: true },
    documentRootPath: { type: DataTypes.STRING(500), allowNull: true },
    renewalNoticeSentAt: { type: DataTypes.DATE, allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  WebsiteDomain.STATUSES = STATUSES;

  WebsiteDomain.associate = (models) => {
    WebsiteDomain.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
  };

  installVisibilityGuard(WebsiteDomain);

  return WebsiteDomain;
};

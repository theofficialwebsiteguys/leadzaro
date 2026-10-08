const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const PROVIDERS = ['namecheap'];
const ENVIRONMENTS = ['production', 'sandbox'];
// 'connected' only ever follows a real, successful API call (ADR 0009).
const STATUSES = ['not_configured', 'unverified', 'connected', 'error'];

module.exports = (sequelize) => {
  const IntegrationConnection = sequelize.define('IntegrationConnection', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    provider: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [PROVIDERS] } },
    environment: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'production', validate: { isIn: [ENVIRONMENTS] },
    },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'not_configured', validate: { isIn: [STATUSES] },
    },
    apiUser: { type: DataTypes.STRING(40), allowNull: true },
    accountUserName: { type: DataTypes.STRING(40), allowNull: true },
    clientIp: { type: DataTypes.STRING(15), allowNull: true },
    credentialsCiphertext: { type: DataTypes.TEXT, allowNull: true },
    credentialsUpdatedAt: { type: DataTypes.DATE, allowNull: true },
    credentialsUpdatedByUserId: { type: DataTypes.UUID, allowNull: true },
    lastTestedAt: { type: DataTypes.DATE, allowNull: true },
    lastVerifiedAt: { type: DataTypes.DATE, allowNull: true },
    lastSyncStartedAt: { type: DataTypes.DATE, allowNull: true },
    lastSyncFinishedAt: { type: DataTypes.DATE, allowNull: true },
    lastSuccessfulSyncAt: { type: DataTypes.DATE, allowNull: true },
    lastSyncStatus: { type: DataTypes.STRING(20), allowNull: true },
    lastSyncTrigger: { type: DataTypes.STRING(20), allowNull: true },
    lastSyncSummary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    lastErrorKind: { type: DataTypes.STRING(40), allowNull: true },
    lastErrorMessage: { type: DataTypes.TEXT, allowNull: true },
    lastErrorProviderCode: { type: DataTypes.STRING(20), allowNull: true },
    lastErrorAt: { type: DataTypes.DATE, allowNull: true },
    syncLockedUntil: { type: DataTypes.DATE, allowNull: true },
    accountSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  });

  IntegrationConnection.PROVIDERS = PROVIDERS;
  IntegrationConnection.ENVIRONMENTS = ENVIRONMENTS;
  IntegrationConnection.STATUSES = STATUSES;

  installVisibilityGuard(IntegrationConnection, { accessModule: 'server/core/domains/domainRegistryAccess.js' });

  return IntegrationConnection;
};

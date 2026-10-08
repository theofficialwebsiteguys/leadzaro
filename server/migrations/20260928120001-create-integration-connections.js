'use strict';

/**
 * One row per agency workspace per connected provider (ADR 0009). Holds
 * the non-secret connection identity (API user, account username, the
 * whitelisted client IPv4, sandbox vs production), the API key encrypted
 * with INTEGRATION_SECRETS_KEY, and the operational state an admin needs:
 * last verified call, last sync outcome and readable error details.
 *
 * `status` is only ever 'connected' after a real, successful API call —
 * there is no simulated connection state.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('IntegrationConnections', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
      },
      provider: { type: Sequelize.STRING(30), allowNull: false },
      environment: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'production' },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'not_configured' },

      apiUser: { type: Sequelize.STRING(40), allowNull: true },
      accountUserName: { type: Sequelize.STRING(40), allowNull: true },
      clientIp: { type: Sequelize.STRING(15), allowNull: true },
      credentialsCiphertext: { type: Sequelize.TEXT, allowNull: true },
      credentialsUpdatedAt: { type: Sequelize.DATE, allowNull: true },
      credentialsUpdatedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
      },

      lastTestedAt: { type: Sequelize.DATE, allowNull: true },
      lastVerifiedAt: { type: Sequelize.DATE, allowNull: true },
      lastSyncStartedAt: { type: Sequelize.DATE, allowNull: true },
      lastSyncFinishedAt: { type: Sequelize.DATE, allowNull: true },
      lastSuccessfulSyncAt: { type: Sequelize.DATE, allowNull: true },
      lastSyncStatus: { type: Sequelize.STRING(20), allowNull: true },
      lastSyncTrigger: { type: Sequelize.STRING(20), allowNull: true },
      lastSyncSummary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      lastErrorKind: { type: Sequelize.STRING(40), allowNull: true },
      lastErrorMessage: { type: Sequelize.TEXT, allowNull: true },
      lastErrorProviderCode: { type: Sequelize.STRING(20), allowNull: true },
      lastErrorAt: { type: Sequelize.DATE, allowNull: true },
      syncLockedUntil: { type: Sequelize.DATE, allowNull: true },
      accountSnapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },

      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('IntegrationConnections', ['agencyOrganizationId', 'provider'], { unique: true, name: 'integration_connections_agency_provider_unique' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('IntegrationConnections');
  },
};

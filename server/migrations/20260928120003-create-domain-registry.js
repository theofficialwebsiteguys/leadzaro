'use strict';

/**
 * The agency's domain registry (ADR 0009).
 *
 * DomainRecords — one row per registrable domain per agency workspace,
 * whether it was synced from Namecheap, typed in by hand, or both. Three
 * kinds of value are kept in separate columns so none can overwrite
 * another:
 *   provider*   what the connected registrar last reported (sync-owned);
 *   estimated*  catalog-price estimates (labelled, never historical cost);
 *   everything else — manual entries and explicit overrides (user-owned,
 *               never touched by a sync).
 * Rows are never deleted by a sync: a domain that stops appearing gets
 * providerMissingSince, and keeps its last known details.
 *
 * ClientDomainLinks — which client (and optionally which of its projects)
 * uses which registration, with the host it uses (subdomains preserved).
 * Rows derived from a website URL are re-evaluated whenever that URL
 * changes; linkOverride records a person's explicit link/unlink decision.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable('DomainRecords', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        agencyOrganizationId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
        },
        domainName: { type: Sequelize.STRING(253), allowNull: false },

        providerKey: { type: Sequelize.STRING(30), allowNull: true },
        providerConnectionId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'IntegrationConnections', key: 'id' }, onDelete: 'SET NULL',
        },
        providerAccountKey: { type: Sequelize.STRING(80), allowNull: true },
        providerDomainId: { type: Sequelize.STRING(40), allowNull: true },
        providerCreatedOn: { type: Sequelize.DATEONLY, allowNull: true },
        providerExpiresOn: { type: Sequelize.DATEONLY, allowNull: true },
        providerIsExpired: { type: Sequelize.BOOLEAN, allowNull: true },
        providerIsLocked: { type: Sequelize.BOOLEAN, allowNull: true },
        providerAutoRenew: { type: Sequelize.BOOLEAN, allowNull: true },
        providerIsPremium: { type: Sequelize.BOOLEAN, allowNull: true },
        providerUsesNamecheapDns: { type: Sequelize.BOOLEAN, allowNull: true },
        providerPrivacy: { type: Sequelize.STRING(30), allowNull: true },
        providerNameservers: { type: Sequelize.JSONB, allowNull: true },
        providerNameserversSyncedAt: { type: Sequelize.DATE, allowNull: true },
        providerNameserversError: { type: Sequelize.STRING(300), allowNull: true },
        providerSslCertificates: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        providerSslSyncedAt: { type: Sequelize.DATE, allowNull: true },
        providerFirstSeenAt: { type: Sequelize.DATE, allowNull: true },
        providerLastSeenAt: { type: Sequelize.DATE, allowNull: true },
        providerMissingSince: { type: Sequelize.DATE, allowNull: true },
        providerCheckedAt: { type: Sequelize.DATE, allowNull: true },

        estimatedRenewalCents: { type: Sequelize.INTEGER, allowNull: true },
        estimatedRenewalCurrency: { type: Sequelize.STRING(3), allowNull: true },
        estimatedRenewalYears: { type: Sequelize.INTEGER, allowNull: true },
        estimatedRenewalFetchedAt: { type: Sequelize.DATE, allowNull: true },
        estimatedRenewalNote: { type: Sequelize.STRING(300), allowNull: true },

        registrarName: { type: Sequelize.STRING(100), allowNull: true },
        manualRegisteredOn: { type: Sequelize.DATEONLY, allowNull: true },
        manualExpiresOn: { type: Sequelize.DATEONLY, allowNull: true },
        manualAutoRenew: { type: Sequelize.BOOLEAN, allowNull: true },
        dnsProviderName: { type: Sequelize.STRING(100), allowNull: true },
        renewalPriceCents: { type: Sequelize.INTEGER, allowNull: true },
        renewalCurrency: { type: Sequelize.STRING(3), allowNull: true },
        renewalPeriodMonths: { type: Sequelize.INTEGER, allowNull: true },
        nextChargeOn: { type: Sequelize.DATEONLY, allowNull: true },
        clientChargeCents: { type: Sequelize.INTEGER, allowNull: true },
        clientChargePeriodMonths: { type: Sequelize.INTEGER, allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        manualUpdatedAt: { type: Sequelize.DATE, allowNull: true },
        manualUpdatedByUserId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },

        ignoredAt: { type: Sequelize.DATE, allowNull: true },
        ignoredByUserId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        expiryNoticeLevel: { type: Sequelize.STRING(10), allowNull: true },
        expiryNoticeForDate: { type: Sequelize.DATEONLY, allowNull: true },

        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('DomainRecords', ['agencyOrganizationId', 'domainName'], { unique: true, name: 'domain_records_agency_domain_unique', transaction });

      await queryInterface.createTable('ClientDomainLinks', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        agencyOrganizationId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
        },
        organizationId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
        },
        projectId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
        },
        domainRecordId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'DomainRecords', key: 'id' }, onDelete: 'CASCADE',
        },
        hostname: { type: Sequelize.STRING(253), allowNull: false },
        source: { type: Sequelize.STRING(20), allowNull: false },
        isPrimary: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        linkOverride: { type: Sequelize.STRING(12), allowNull: true },
        overrideAt: { type: Sequelize.DATE, allowNull: true },
        overrideByUserId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdByUserId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      // One link per registration per scope (a project, or the client as a whole).
      await queryInterface.addIndex('ClientDomainLinks', ['projectId', 'domainRecordId'], {
        unique: true, name: 'client_domain_links_project_unique', where: { projectId: { [Sequelize.Op.ne]: null } }, transaction,
      });
      await queryInterface.addIndex('ClientDomainLinks', ['organizationId', 'domainRecordId'], {
        unique: true, name: 'client_domain_links_client_unique', where: { projectId: null }, transaction,
      });
      await queryInterface.addIndex('ClientDomainLinks', ['domainRecordId'], { name: 'client_domain_links_domain_record', transaction });
      await queryInterface.addIndex('ClientDomainLinks', ['agencyOrganizationId'], { name: 'client_domain_links_agency', transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ClientDomainLinks', { transaction });
      await queryInterface.dropTable('DomainRecords', { transaction });
    });
  },
};

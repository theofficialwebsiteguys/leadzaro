const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

/** Manually entered values and overrides — never written by a sync (ADR 0009). */
const MANUAL_FIELDS = [
  'registrarName', 'manualRegisteredOn', 'manualExpiresOn', 'manualAutoRenew', 'dnsProviderName',
  'renewalPriceCents', 'renewalCurrency', 'renewalPeriodMonths', 'nextChargeOn',
  'clientChargeCents', 'clientChargePeriodMonths', 'notes',
];

module.exports = (sequelize) => {
  const DomainRecord = sequelize.define('DomainRecord', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    domainName: { type: DataTypes.STRING(253), allowNull: false },

    providerKey: { type: DataTypes.STRING(30), allowNull: true },
    providerConnectionId: { type: DataTypes.UUID, allowNull: true },
    providerAccountKey: { type: DataTypes.STRING(80), allowNull: true },
    providerDomainId: { type: DataTypes.STRING(40), allowNull: true },
    providerCreatedOn: { type: DataTypes.DATEONLY, allowNull: true },
    providerExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    providerIsExpired: { type: DataTypes.BOOLEAN, allowNull: true },
    providerIsLocked: { type: DataTypes.BOOLEAN, allowNull: true },
    providerAutoRenew: { type: DataTypes.BOOLEAN, allowNull: true },
    providerIsPremium: { type: DataTypes.BOOLEAN, allowNull: true },
    providerUsesNamecheapDns: { type: DataTypes.BOOLEAN, allowNull: true },
    providerPrivacy: { type: DataTypes.STRING(30), allowNull: true },
    providerNameservers: { type: DataTypes.JSONB, allowNull: true },
    providerNameserversSyncedAt: { type: DataTypes.DATE, allowNull: true },
    providerNameserversError: { type: DataTypes.STRING(300), allowNull: true },
    providerSslCertificates: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    providerSslSyncedAt: { type: DataTypes.DATE, allowNull: true },
    providerFirstSeenAt: { type: DataTypes.DATE, allowNull: true },
    providerLastSeenAt: { type: DataTypes.DATE, allowNull: true },
    providerMissingSince: { type: DataTypes.DATE, allowNull: true },
    providerCheckedAt: { type: DataTypes.DATE, allowNull: true },

    estimatedRenewalCents: { type: DataTypes.INTEGER, allowNull: true },
    estimatedRenewalCurrency: { type: DataTypes.STRING(3), allowNull: true },
    estimatedRenewalYears: { type: DataTypes.INTEGER, allowNull: true },
    estimatedRenewalFetchedAt: { type: DataTypes.DATE, allowNull: true },
    estimatedRenewalNote: { type: DataTypes.STRING(300), allowNull: true },

    registrarName: { type: DataTypes.STRING(100), allowNull: true },
    manualRegisteredOn: { type: DataTypes.DATEONLY, allowNull: true },
    manualExpiresOn: { type: DataTypes.DATEONLY, allowNull: true },
    manualAutoRenew: { type: DataTypes.BOOLEAN, allowNull: true },
    dnsProviderName: { type: DataTypes.STRING(100), allowNull: true },
    renewalPriceCents: { type: DataTypes.INTEGER, allowNull: true },
    renewalCurrency: { type: DataTypes.STRING(3), allowNull: true },
    renewalPeriodMonths: { type: DataTypes.INTEGER, allowNull: true },
    nextChargeOn: { type: DataTypes.DATEONLY, allowNull: true },
    clientChargeCents: { type: DataTypes.INTEGER, allowNull: true },
    clientChargePeriodMonths: { type: DataTypes.INTEGER, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    manualUpdatedAt: { type: DataTypes.DATE, allowNull: true },
    manualUpdatedByUserId: { type: DataTypes.UUID, allowNull: true },

    ignoredAt: { type: DataTypes.DATE, allowNull: true },
    ignoredByUserId: { type: DataTypes.UUID, allowNull: true },
    expiryNoticeLevel: { type: DataTypes.STRING(10), allowNull: true },
    expiryNoticeForDate: { type: DataTypes.DATEONLY, allowNull: true },
  });

  DomainRecord.MANUAL_FIELDS = MANUAL_FIELDS;

  installVisibilityGuard(DomainRecord, { accessModule: 'server/core/domains/domainRegistryAccess.js' });

  return DomainRecord;
};

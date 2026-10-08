const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annually', 'one_time'];
const PAYMENT_STATUSES = ['current', 'pending', 'overdue', 'paused', 'cancelled'];

// Fields a request body may set, grouped by the form that owns them.
// Anything not listed here (ids, tenant columns, timestamps) is never
// writable through the profile API. The domainName/registrar/
// hostingProvider/domainRenewalDate/hostingRenewalDate columns are
// retired: their data was copied into the domain registry (ADR 0009) and
// they are kept only so that migration can be rolled back.
const LEGACY_WEBSITE_FIELDS = ['domainName', 'registrar', 'hostingProvider', 'domainRenewalDate', 'hostingRenewalDate'];
const EDITABLE_FIELDS = {
  identity: ['description', 'logoFileId', 'featuredImageFileId', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country', 'internalNotes'],
  website: ['websiteUrl', 'adminLinks', 'accessNotes'],
  billing: ['setupPriceCents', 'recurringPriceCents', 'billingFrequency', 'paymentStatus', 'billingLinks', 'billingNotes', 'internalMonthlyCostCents', 'internalCostNotes'],
  // Account management (ADR 0013).
  account: ['accountManagerUserId', 'services', 'scopeNotes', 'waitingOn', 'waitingOnNote', 'nextActionAt', 'nextActionNote', 'clientSince', 'clientEndedAt', 'endReason'],
};
const WAITING_ON = ['us', 'client'];
const ACQUISITION_SOURCES = ['sales', 'existing'];

module.exports = (sequelize) => {
  const ClientProfile = sequelize.define('ClientProfile', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: false, unique: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },

    description: { type: DataTypes.TEXT, allowNull: true },
    logoFileId: { type: DataTypes.UUID, allowNull: true },
    featuredImageFileId: { type: DataTypes.UUID, allowNull: true },
    addressLine1: { type: DataTypes.STRING(200), allowNull: true },
    addressLine2: { type: DataTypes.STRING(200), allowNull: true },
    city: { type: DataTypes.STRING(100), allowNull: true },
    state: { type: DataTypes.STRING(100), allowNull: true },
    postalCode: { type: DataTypes.STRING(20), allowNull: true },
    country: { type: DataTypes.STRING(100), allowNull: true },
    internalNotes: { type: DataTypes.TEXT, allowNull: true },

    websiteUrl: { type: DataTypes.STRING(500), allowNull: true },
    domainName: { type: DataTypes.STRING(255), allowNull: true },
    registrar: { type: DataTypes.STRING(150), allowNull: true },
    hostingProvider: { type: DataTypes.STRING(150), allowNull: true },
    domainRenewalDate: { type: DataTypes.DATEONLY, allowNull: true },
    hostingRenewalDate: { type: DataTypes.DATEONLY, allowNull: true },
    adminLinks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    accessNotes: { type: DataTypes.TEXT, allowNull: true },

    setupPriceCents: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0 } },
    recurringPriceCents: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0 } },
    billingFrequency: { type: DataTypes.STRING(20), allowNull: true, validate: { isIn: [BILLING_FREQUENCIES] } },
    paymentStatus: { type: DataTypes.STRING(20), allowNull: true, validate: { isIn: [PAYMENT_STATUSES] } },
    billingLinks: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    billingNotes: { type: DataTypes.TEXT, allowNull: true },
    internalMonthlyCostCents: { type: DataTypes.INTEGER, allowNull: true, validate: { min: 0 } },
    internalCostNotes: { type: DataTypes.TEXT, allowNull: true },

    // Account management (ADR 0013): who looks after the client, what they
    // bought, who the account is waiting on and what happens next.
    accountManagerUserId: { type: DataTypes.UUID, allowNull: true },
    services: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    scopeNotes: { type: DataTypes.TEXT, allowNull: true },
    waitingOn: { type: DataTypes.STRING(10), allowNull: true, validate: { isIn: [WAITING_ON] } },
    waitingOnNote: { type: DataTypes.STRING(255), allowNull: true },
    waitingOnSince: { type: DataTypes.DATE, allowNull: true },
    nextActionAt: { type: DataTypes.DATE, allowNull: true },
    nextActionNote: { type: DataTypes.STRING(255), allowNull: true },
    // When they became a client (and stopped being one) — drives growth and retention.
    clientSince: { type: DataTypes.DATEONLY, allowNull: true },
    clientEndedAt: { type: DataTypes.DATEONLY, allowNull: true },
    endReason: { type: DataTypes.STRING(255), allowNull: true },
    // 'sales' (won through Leadzaro) or 'existing' (added directly) — existing clients never count as new sales.
    acquisitionSource: { type: DataTypes.STRING(20), allowNull: true, validate: { isIn: [ACQUISITION_SOURCES] } },
  });

  ClientProfile.BILLING_FREQUENCIES = BILLING_FREQUENCIES;
  ClientProfile.PAYMENT_STATUSES = PAYMENT_STATUSES;
  ClientProfile.EDITABLE_FIELDS = EDITABLE_FIELDS;
  ClientProfile.WAITING_ON = WAITING_ON;
  ClientProfile.ACQUISITION_SOURCES = ACQUISITION_SOURCES;
  ClientProfile.LEGACY_WEBSITE_FIELDS = LEGACY_WEBSITE_FIELDS;

  ClientProfile.associate = (models) => {
    ClientProfile.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    ClientProfile.belongsTo(models.User, { foreignKey: 'accountManagerUserId', as: 'accountManager' });
  };

  installVisibilityGuard(ClientProfile);

  return ClientProfile;
};

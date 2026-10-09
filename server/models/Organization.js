const { DataTypes } = require('sequelize');

const TYPES = ['agency', 'client', 'prospect'];
const STATUSES = ['active', 'archived', 'trash'];

module.exports = (sequelize) => {
  const Organization = sequelize.define('Organization', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING(180),
      allowNull: false,
      unique: true,
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [TYPES] },
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
      validate: { isIn: [STATUSES] },
    },
    branding: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Which agency organization manages this one — populated for
    // client/prospect organizations at conversion time. Required for any
    // agency-scoped action (e.g. impersonation) to know which client
    // organizations a given agency is actually allowed to touch; without
    // it, "type: 'client'" alone doesn't express ownership.
    managingAgencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Business details (ADR 0011), owned by the agency — never written back
    // to the shared Lead row. detailsSource records where each came from
    // ('google_places', 'manual', 'inbound_form', 'verified').
    phone: { type: DataTypes.STRING(50), allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    website: { type: DataTypes.STRING(500), allowNull: true },
    addressLine1: { type: DataTypes.STRING(255), allowNull: true },
    city: { type: DataTypes.STRING(100), allowNull: true },
    state: { type: DataTypes.STRING(100), allowNull: true },
    postalCode: { type: DataTypes.STRING(20), allowNull: true },
    category: { type: DataTypes.STRING(150), allowNull: true },
    detailsSource: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    // Contact research (ADR 0014): the business's Facebook page and the
    // email-discovery record (status, sources checked, what was found where).
    facebookUrl: { type: DataTypes.STRING(500), allowNull: true },
    emailDiscovery: { type: DataTypes.JSONB, allowNull: true },
    // Workspace-wide defaults for an agency (ADR 0012): timezone, default
    // search location/keywords, default follow-up days.
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  });

  Organization.TYPES = TYPES;
  Organization.STATUSES = STATUSES;

  Organization.associate = (models) => {
    Organization.hasMany(models.OrganizationMembership, { foreignKey: 'organizationId', as: 'memberships' });
    Organization.hasMany(models.Invitation, { foreignKey: 'organizationId', as: 'invitations' });
    Organization.hasMany(models.SavedLead, { foreignKey: 'organizationId', as: 'savedLeads' });
    Organization.hasMany(models.OutreachActivity, { foreignKey: 'organizationId', as: 'outreachActivities' });
    Organization.hasMany(models.LeadNote, { foreignKey: 'organizationId', as: 'leadNotes' });
    Organization.belongsTo(models.Organization, { foreignKey: 'managingAgencyOrganizationId', as: 'managingAgency' });
    Organization.hasMany(models.Organization, { foreignKey: 'managingAgencyOrganizationId', as: 'managedClients' });
    Organization.hasMany(models.Opportunity, { foreignKey: 'organizationId', as: 'opportunities' });
    Organization.hasMany(models.Contact, { foreignKey: 'organizationId', as: 'contacts' });
    Organization.hasMany(models.Location, { foreignKey: 'organizationId', as: 'locations' });
    Organization.hasOne(models.BillingAccount, { foreignKey: 'organizationId', as: 'billingAccount' });
    Organization.hasOne(models.ClientProfile, { foreignKey: 'organizationId', as: 'clientProfile' });
  };

  return Organization;
};

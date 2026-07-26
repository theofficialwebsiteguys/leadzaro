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
  };

  return Organization;
};

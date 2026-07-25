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
  });

  Organization.TYPES = TYPES;
  Organization.STATUSES = STATUSES;

  Organization.associate = (models) => {
    Organization.hasMany(models.OrganizationMembership, { foreignKey: 'organizationId', as: 'memberships' });
    Organization.hasMany(models.Invitation, { foreignKey: 'organizationId', as: 'invitations' });
    Organization.hasMany(models.SavedLead, { foreignKey: 'organizationId', as: 'savedLeads' });
    Organization.hasMany(models.OutreachActivity, { foreignKey: 'organizationId', as: 'outreachActivities' });
    Organization.hasMany(models.LeadNote, { foreignKey: 'organizationId', as: 'leadNotes' });
  };

  return Organization;
};

const { DataTypes } = require('sequelize');

const STATUSES = ['invited', 'active', 'suspended', 'removed'];
const MEMBERSHIP_TYPES = ['employee', 'client'];

module.exports = (sequelize) => {
  const OrganizationMembership = sequelize.define('OrganizationMembership', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'invited',
      validate: { isIn: [STATUSES] },
    },
    membershipType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [MEMBERSHIP_TYPES] },
    },
    title: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    invitedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    acceptedAt: {
      type: DataTypes.DATE,
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
  }, {
    indexes: [
      { unique: true, fields: ['organizationId', 'userId'] },
    ],
  });

  OrganizationMembership.STATUSES = STATUSES;
  OrganizationMembership.MEMBERSHIP_TYPES = MEMBERSHIP_TYPES;

  OrganizationMembership.associate = (models) => {
    OrganizationMembership.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    OrganizationMembership.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    OrganizationMembership.belongsToMany(models.Role, {
      through: models.MembershipRole,
      foreignKey: 'membershipId',
      otherKey: 'roleId',
      as: 'roles',
    });
    OrganizationMembership.hasMany(models.MembershipRole, { foreignKey: 'membershipId', as: 'membershipRoles' });
    OrganizationMembership.hasMany(models.MembershipPermissionOverride, { foreignKey: 'membershipId', as: 'permissionOverrides' });
  };

  return OrganizationMembership;
};

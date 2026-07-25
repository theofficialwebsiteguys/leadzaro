const { DataTypes } = require('sequelize');

const SCOPES = ['employee', 'client'];

module.exports = (sequelize) => {
  const Role = sequelize.define('Role', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    key: {
      type: DataTypes.STRING(60),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    scope: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [SCOPES] },
    },
    isSystem: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  });

  Role.SCOPES = SCOPES;

  Role.associate = (models) => {
    Role.belongsToMany(models.Permission, {
      through: models.RolePermission,
      foreignKey: 'roleId',
      otherKey: 'permissionId',
      as: 'permissions',
    });
    Role.belongsToMany(models.OrganizationMembership, {
      through: models.MembershipRole,
      foreignKey: 'roleId',
      otherKey: 'membershipId',
      as: 'memberships',
    });
    Role.hasMany(models.RolePermission, { foreignKey: 'roleId', as: 'rolePermissions' });
  };

  return Role;
};

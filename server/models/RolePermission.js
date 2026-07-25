const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RolePermission = sequelize.define('RolePermission', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    roleId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    permissionId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  }, {
    indexes: [
      { unique: true, fields: ['roleId', 'permissionId'] },
    ],
  });

  RolePermission.associate = (models) => {
    RolePermission.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
    RolePermission.belongsTo(models.Permission, { foreignKey: 'permissionId', as: 'permission' });
  };

  return RolePermission;
};

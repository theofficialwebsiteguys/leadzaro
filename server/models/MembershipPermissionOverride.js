const { DataTypes } = require('sequelize');

const EFFECTS = ['grant', 'restrict'];

module.exports = (sequelize) => {
  const MembershipPermissionOverride = sequelize.define('MembershipPermissionOverride', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    membershipId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    permissionId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    effect: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: { isIn: [EFFECTS] },
    },
    reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    createdByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    indexes: [
      { unique: true, fields: ['membershipId', 'permissionId'] },
    ],
  });

  MembershipPermissionOverride.EFFECTS = EFFECTS;

  MembershipPermissionOverride.associate = (models) => {
    MembershipPermissionOverride.belongsTo(models.OrganizationMembership, { foreignKey: 'membershipId', as: 'membership' });
    MembershipPermissionOverride.belongsTo(models.Permission, { foreignKey: 'permissionId', as: 'permission' });
  };

  return MembershipPermissionOverride;
};

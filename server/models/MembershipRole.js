const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const MembershipRole = sequelize.define('MembershipRole', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    membershipId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    roleId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    assignedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    indexes: [
      { unique: true, fields: ['membershipId', 'roleId'] },
    ],
  });

  MembershipRole.associate = (models) => {
    MembershipRole.belongsTo(models.OrganizationMembership, { foreignKey: 'membershipId', as: 'membership' });
    MembershipRole.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
  };

  return MembershipRole;
};

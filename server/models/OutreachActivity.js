const { DataTypes } = require('sequelize');

const ACTIVITY_TYPES = ['email', 'call', 'visit', 'message', 'linkedin', 'other'];

module.exports = (sequelize) => {
  const OutreachActivity = sequelize.define('OutreachActivity', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    leadId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM(...ACTIVITY_TYPES),
      allowNull: false,
      defaultValue: 'other',
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  OutreachActivity.associate = (models) => {
    OutreachActivity.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    OutreachActivity.belongsTo(models.Lead, { foreignKey: 'leadId', as: 'lead' });
  };

  return OutreachActivity;
};

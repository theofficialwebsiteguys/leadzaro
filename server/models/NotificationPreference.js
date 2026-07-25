const { DataTypes } = require('sequelize');

const CHANNELS = ['in_app', 'email'];
const FREQUENCIES = ['immediate', 'daily', 'weekly', 'muted'];

module.exports = (sequelize) => {
  const NotificationPreference = sequelize.define('NotificationPreference', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(60),
      allowNull: false,
    },
    channel: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [CHANNELS] },
    },
    frequency: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'immediate',
      validate: { isIn: [FREQUENCIES] },
    },
  }, {
    indexes: [
      { unique: true, fields: ['userId', 'category', 'channel'] },
    ],
  });

  NotificationPreference.CHANNELS = CHANNELS;
  NotificationPreference.FREQUENCIES = FREQUENCIES;

  NotificationPreference.associate = (models) => {
    NotificationPreference.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return NotificationPreference;
};

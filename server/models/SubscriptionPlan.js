const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SubscriptionPlan = sequelize.define('SubscriptionPlan', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.ENUM('Free Trial', 'Starter', 'Pro', 'Agency'),
      allowNull: false,
    },
    price: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      defaultValue: 0,
    },
    monthlySearches: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10,
      comment: '-1 means unlimited',
    },
    savedLeadsLimit: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 25,
      comment: '-1 means unlimited',
    },
    exportAccess: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    teamMembers: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    advancedFilters: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  });

  SubscriptionPlan.associate = (models) => {
    SubscriptionPlan.hasMany(models.UserSubscription, { foreignKey: 'planId', as: 'subscriptions' });
  };

  return SubscriptionPlan;
};

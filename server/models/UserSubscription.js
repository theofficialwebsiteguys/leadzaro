const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserSubscription = sequelize.define('UserSubscription', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    planId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'cancelled', 'expired', 'trialing'),
      defaultValue: 'trialing',
    },
    stripeCustomerId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    stripeSubscriptionId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    currentPeriodStart: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    currentPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    searchesUsedThisMonth: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    leadsUsedTotal: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  });

  UserSubscription.associate = (models) => {
    UserSubscription.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    UserSubscription.belongsTo(models.SubscriptionPlan, { foreignKey: 'planId', as: 'plan' });
  };

  return UserSubscription;
};

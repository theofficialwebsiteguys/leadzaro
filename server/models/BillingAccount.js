const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BillingAccount = sequelize.define('BillingAccount', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    stripeCustomerId: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
    },
  });

  BillingAccount.associate = (models) => {
    BillingAccount.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    BillingAccount.hasMany(models.Subscription, { foreignKey: 'billingAccountId', as: 'subscriptions' });
  };

  return BillingAccount;
};

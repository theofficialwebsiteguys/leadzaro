const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ServicePlan = sequelize.define('ServicePlan', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Validated reference string, not an enum — matches pipelineCatalog.js's
    // reasoning: a new plan is a data change, not a code change.
    key: {
      type: DataTypes.STRING(60),
      allowNull: false,
      unique: true,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    priceType: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    amountCents: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    billingInterval: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    stripeProductId: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    stripePriceId: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
  });

  return ServicePlan;
};

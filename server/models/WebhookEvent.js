const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const WebhookEvent = sequelize.define('WebhookEvent', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // The idempotency key. A unique-violation on inserting this is what
    // makes "the same Stripe event never processed twice" a database
    // guarantee rather than an application-level check that could race.
    stripeEventId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    eventType: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'received',
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  return WebhookEvent;
};

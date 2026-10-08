const { DataTypes } = require('sequelize');

// Links one business (prospect or client Organization) to one Stripe
// customer per mode (live/test/mock). The same link survives conversion to
// a client, so the paying customer is reused rather than recreated.
module.exports = (sequelize) => {
  const StripeCustomerLink = sequelize.define('StripeCustomerLink', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    stripeCustomerId: { type: DataTypes.STRING(255), allowNull: false },
    stripeMode: { type: DataTypes.STRING(10), allowNull: false },
    stripeAccountId: { type: DataTypes.STRING(100), allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    name: { type: DataTypes.STRING(255), allowNull: true },
    linkMethod: { type: DataTypes.STRING(20), allowNull: false },
    linkedByUserId: { type: DataTypes.UUID, allowNull: true },
    archivedAt: { type: DataTypes.DATE, allowNull: true },
  });

  StripeCustomerLink.associate = (models) => {
    StripeCustomerLink.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
  };

  return StripeCustomerLink;
};

const { DataTypes } = require('sequelize');

// Deliberately NOT installVisibilityGuard(Contact): several existing,
// already-tested call sites (clientInvitationService.js, crm/mergeService.js)
// query Contact directly with their own explicit organizationId scoping,
// not through clientVisibleModels.js. Retrofitting the guard here would
// throw on all of them. New code should still go through
// listContactsForRequester/getContactByIdForRequester in
// clientVisibleModels.js for consistency, even though the model itself
// isn't hook-enforced.
module.exports = (sequelize) => {
  const Contact = sequelize.define('Contact', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // See Opportunity.js for why this is denormalized rather than
    // resolved via a join through the prospect organization.
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: { isEmail: true },
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    isPrimary: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    doNotContact: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    verifiedAt: { type: DataTypes.DATE, allowNull: true },

    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  Contact.associate = (models) => {
    Contact.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
  };

  return Contact;
};

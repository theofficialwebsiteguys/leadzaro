const { DataTypes } = require('sequelize');

const STATUSES = ['pending', 'accepted', 'revoked', 'expired'];
const MEMBERSHIP_TYPES = ['employee', 'client'];

module.exports = (sequelize) => {
  const Invitation = sequelize.define('Invitation', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: { isEmail: true },
    },
    membershipType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: { isIn: [MEMBERSHIP_TYPES] },
    },
    roleKeys: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    tokenHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: { isIn: [STATUSES] },
    },
    invitedByUserId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    acceptedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    acceptedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    revokedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  });

  Invitation.STATUSES = STATUSES;
  Invitation.MEMBERSHIP_TYPES = MEMBERSHIP_TYPES;

  Invitation.associate = (models) => {
    Invitation.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    Invitation.belongsTo(models.User, { foreignKey: 'invitedByUserId', as: 'invitedBy' });
    Invitation.belongsTo(models.User, { foreignKey: 'acceptedByUserId', as: 'acceptedBy' });
  };

  return Invitation;
};

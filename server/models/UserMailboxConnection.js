const { DataTypes } = require('sequelize');

// 'connected' until Google rejects the stored token, then 'error' (reconnect needed).
const STATUSES = ['connected', 'error'];

/** A person's own mailbox, connected for sending sales email as them (ADR 0015). */
module.exports = (sequelize) => {
  const UserMailboxConnection = sequelize.define('UserMailboxConnection', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    provider: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'gmail' },
    email: { type: DataTypes.STRING(255), allowNull: false },
    scopes: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'connected', validate: { isIn: [STATUSES] },
    },
    // Encrypted with secretBox, bound to "<userId>:<agencyId>:gmail". Never returned to clients.
    refreshTokenCiphertext: { type: DataTypes.TEXT, allowNull: false },
    connectedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    lastErrorMessage: { type: DataTypes.STRING(500), allowNull: true },
    lastErrorAt: { type: DataTypes.DATE, allowNull: true },
  });

  UserMailboxConnection.STATUSES = STATUSES;

  UserMailboxConnection.associate = (models) => {
    UserMailboxConnection.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return UserMailboxConnection;
};

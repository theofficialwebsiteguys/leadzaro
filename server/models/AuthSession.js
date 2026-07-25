const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AuthSession = sequelize.define('AuthSession', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    tokenHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    userAgent: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    ipAddress: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    lastSeenAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    revokedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    revokedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    revokedReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  });

  AuthSession.associate = (models) => {
    AuthSession.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return AuthSession;
};

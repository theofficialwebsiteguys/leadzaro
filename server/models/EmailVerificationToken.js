const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailVerificationToken = sequelize.define('EmailVerificationToken', {
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
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    usedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  }, {
    updatedAt: false,
  });

  EmailVerificationToken.associate = (models) => {
    EmailVerificationToken.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return EmailVerificationToken;
};

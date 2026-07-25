const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    actorUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    action: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    targetType: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    targetId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    ipAddress: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    requestId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
  }, {
    updatedAt: false,
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    AuditLog.belongsTo(models.User, { foreignKey: 'actorUserId', as: 'actor' });
  };

  return AuditLog;
};

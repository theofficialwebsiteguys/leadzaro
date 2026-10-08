const { DataTypes } = require('sequelize');

const ACTIVITY_TYPES = ['email', 'call', 'visit', 'message', 'linkedin', 'other'];

module.exports = (sequelize) => {
  const OutreachActivity = sequelize.define('OutreachActivity', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    leadId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM(...ACTIVITY_TYPES),
      allowNull: false,
      defaultValue: 'other',
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    // Conversations (ADR 0011). origin: platform (sent/received by Leadzaro),
    // manual (logged by a person), external (opened in another app).
    opportunityId: { type: DataTypes.UUID, allowNull: true },
    contactId: { type: DataTypes.UUID, allowNull: true },
    channel: { type: DataTypes.STRING(20), allowNull: true },
    direction: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'outbound' },
    origin: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'manual' },
    outcome: { type: DataTypes.STRING(30), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: true },
    subject: { type: DataTypes.STRING(300), allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: true },
    toAddress: { type: DataTypes.STRING(255), allowNull: true },
    fromAddress: { type: DataTypes.STRING(255), allowNull: true },
    provider: { type: DataTypes.STRING(30), allowNull: true },
    providerMessageId: { type: DataTypes.STRING(100), allowNull: true },
    errorMessage: { type: DataTypes.STRING(500), allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: true, unique: true },
    templateId: { type: DataTypes.UUID, allowNull: true },
    durationSeconds: { type: DataTypes.INTEGER, allowNull: true },
    completedFollowUp: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    occurredAt: { type: DataTypes.DATE, allowNull: true },
  });

  OutreachActivity.associate = (models) => {
    OutreachActivity.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
    OutreachActivity.belongsTo(models.Lead, { foreignKey: 'leadId', as: 'lead' });
    OutreachActivity.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    OutreachActivity.belongsTo(models.Opportunity, { foreignKey: 'opportunityId', as: 'opportunity' });
    OutreachActivity.belongsTo(models.Contact, { foreignKey: 'contactId', as: 'contact' });
  };

  return OutreachActivity;
};

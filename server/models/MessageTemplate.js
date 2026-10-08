const { DataTypes } = require('sequelize');

const SCOPES = ['personal', 'shared'];
const CHANNELS = ['email', 'sms', 'call'];
const CATEGORIES = ['intro', 'voicemail', 'follow_up', 'meeting_confirmation', 'objection', 'payment_reminder', 'welcome', 'other'];

// Outreach templates (ADR 0011): personal (owner only) or shared across the
// agency (managed by templates.manage_shared). Call templates are scripts.
module.exports = (sequelize) => {
  const MessageTemplate = sequelize.define('MessageTemplate', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    ownerUserId: { type: DataTypes.UUID, allowNull: true },
    scope: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [SCOPES] } },
    category: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [CATEGORIES] } },
    channel: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [CHANNELS] } },
    name: { type: DataTypes.STRING(150), allowNull: false },
    subject: { type: DataTypes.STRING(300), allowNull: true },
    body: { type: DataTypes.TEXT, allowNull: false },
    isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
    archivedAt: { type: DataTypes.DATE, allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
    updatedByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  MessageTemplate.SCOPES = SCOPES;
  MessageTemplate.CHANNELS = CHANNELS;
  MessageTemplate.CATEGORIES = CATEGORIES;

  MessageTemplate.associate = (models) => {
    MessageTemplate.belongsTo(models.User, { foreignKey: 'ownerUserId', as: 'owner' });
  };

  return MessageTemplate;
};

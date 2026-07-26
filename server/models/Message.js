const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    channelId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Denormalized (see migration comment) so a Message's own top-level
    // query is scoped directly, never via an `include` of ProjectChannel/Project.
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    authorUserId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    mentionedUserIds: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    threadParentMessageId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    convertedToTaskId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  });

  Message.associate = (models) => {
    Message.belongsTo(models.ProjectChannel, { foreignKey: 'channelId', as: 'channel' });
    Message.belongsTo(models.User, { foreignKey: 'authorUserId', as: 'author' });
    Message.belongsTo(models.Message, { foreignKey: 'threadParentMessageId', as: 'threadParent' });
    Message.belongsTo(models.Task, { foreignKey: 'convertedToTaskId', as: 'convertedToTask' });
  };

  installVisibilityGuard(Message);

  return Message;
};

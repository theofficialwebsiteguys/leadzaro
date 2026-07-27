const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const SCOPES = ['organization', 'project', 'website_asset', 'task_attachment', 'message_attachment', 'request_attachment', 'meeting_attachment'];

// The scopes a client can ever see, subject to isPrivate: false AND (for
// task_attachment/message_attachment) an additional per-file check that
// the referenced Task/Message is itself client-visible — see
// clientVisibleModels.js's fileWhereForRequester / filterFilesForClient.
const CLIENT_FACING_SCOPES = ['project', 'task_attachment', 'message_attachment', 'request_attachment'];

module.exports = (sequelize) => {
  const File = sequelize.define('File', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    projectId: { type: DataTypes.UUID, allowNull: true },
    uploadedByUserId: { type: DataTypes.UUID, allowNull: false },
    scope: {
      type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [SCOPES] },
    },
    relatedId: { type: DataTypes.UUID, allowNull: true },
    storageKey: { type: DataTypes.STRING(500), allowNull: false },
    originalName: { type: DataTypes.STRING(255), allowNull: false },
    mimeType: { type: DataTypes.STRING(100), allowNull: false },
    sizeBytes: { type: DataTypes.INTEGER, allowNull: false },
    isPrivate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  });

  File.SCOPES = SCOPES;
  File.CLIENT_FACING_SCOPES = CLIENT_FACING_SCOPES;

  File.associate = (models) => {
    File.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    File.belongsTo(models.User, { foreignKey: 'uploadedByUserId', as: 'uploadedBy' });
  };

  installVisibilityGuard(File);

  return File;
};

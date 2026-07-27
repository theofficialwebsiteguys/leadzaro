const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const SCOPES = ['organization', 'project', 'website_asset', 'task_attachment', 'message_attachment', 'request_attachment', 'meeting_attachment'];

// The scopes a client can ever see, subject to isPrivate: false AND (for
// task_attachment/message_attachment/website_asset) an additional
// per-file check that the referenced Task/Message/Website is itself
// visible to the requester — see clientVisibleModels.js's
// fileWhereForRequester / filterFilesForClient. website_asset joined
// this allowlist in Phase 5 (current-phase-plan.md § 2k) — Phase 4 had
// deliberately excluded it, since a non-private website_asset file had
// no inherent tie to a specific client-visible context until a real,
// visibility-checkable Website existed.
const CLIENT_FACING_SCOPES = ['project', 'task_attachment', 'message_attachment', 'request_attachment', 'website_asset'];

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
    variants: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: {},
    },
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

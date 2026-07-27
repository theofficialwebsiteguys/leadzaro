const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const EDITING_LEVELS = ['basic', 'professional', 'advanced'];

module.exports = (sequelize) => {
  const WebsiteEditorAssignment = sequelize.define('WebsiteEditorAssignment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    editingLevel: {
      type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [EDITING_LEVELS] },
    },
    assignedByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  WebsiteEditorAssignment.EDITING_LEVELS = EDITING_LEVELS;

  WebsiteEditorAssignment.associate = (models) => {
    WebsiteEditorAssignment.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsiteEditorAssignment.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  installVisibilityGuard(WebsiteEditorAssignment);

  return WebsiteEditorAssignment;
};

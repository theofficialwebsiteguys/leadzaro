const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const TYPES = ['text', 'image', 'file', 'link'];
const STATUSES = ['new', 'reviewed', 'used'];

module.exports = (sequelize) => {
  const ContentInboxItem = sequelize.define('ContentInboxItem', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    type: {
      type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [TYPES] },
    },
    body: { type: DataTypes.TEXT, allowNull: false },
    submittedByUserId: { type: DataTypes.UUID, allowNull: false },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'new', validate: { isIn: [STATUSES] },
    },
  });

  ContentInboxItem.TYPES = TYPES;
  ContentInboxItem.STATUSES = STATUSES;

  ContentInboxItem.associate = (models) => {
    ContentInboxItem.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    ContentInboxItem.belongsTo(models.User, { foreignKey: 'submittedByUserId', as: 'submittedBy' });
  };

  installVisibilityGuard(ContentInboxItem);

  return ContentInboxItem;
};

const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const CATEGORIES = ['content', 'image', 'hours', 'page_section', 'design', 'form', 'bug', 'domain', 'analytics', 'functionality', 'emergency'];
const STATUSES = ['queued', 'in_progress', 'waiting_on_client', 'completed', 'declined'];

module.exports = (sequelize) => {
  const ClientRequest = sequelize.define('ClientRequest', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    category: {
      type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [CATEGORIES] },
    },
    description: { type: DataTypes.TEXT, allowNull: false },
    submittedByUserId: { type: DataTypes.UUID, allowNull: false },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'queued', validate: { isIn: [STATUSES] },
    },
    convertedToTaskId: { type: DataTypes.UUID, allowNull: true },
    estimatedMinutes: { type: DataTypes.INTEGER, allowNull: true },
    actualMinutes: { type: DataTypes.INTEGER, allowNull: true },
  });

  ClientRequest.CATEGORIES = CATEGORIES;
  ClientRequest.STATUSES = STATUSES;

  ClientRequest.associate = (models) => {
    ClientRequest.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    ClientRequest.belongsTo(models.User, { foreignKey: 'submittedByUserId', as: 'submittedBy' });
    ClientRequest.belongsTo(models.Task, { foreignKey: 'convertedToTaskId', as: 'convertedToTask' });
  };

  installVisibilityGuard(ClientRequest);

  return ClientRequest;
};

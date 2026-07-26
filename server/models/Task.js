const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

module.exports = (sequelize) => {
  const Task = sequelize.define('Task', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Denormalized from Project at creation time (never resolved via an
    // `include` of Project — see ADR 0007's documented include-bypass
    // gap). organizationId scopes a client request; agencyOrganizationId
    // scopes an employee request.
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    parentTaskId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    assigneeUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'todo',
      validate: { isIn: [STATUSES] },
    },
    priority: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'medium',
      validate: { isIn: [PRIORITIES] },
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    estimateMinutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    tags: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    // Internal by default — must be explicitly marked true. The safer
    // default direction for the phase's major gate.
    isClientVisible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  Task.STATUSES = STATUSES;
  Task.PRIORITIES = PRIORITIES;

  Task.associate = (models) => {
    Task.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    Task.belongsTo(models.User, { foreignKey: 'assigneeUserId', as: 'assignee' });
    Task.belongsTo(models.Task, { foreignKey: 'parentTaskId', as: 'parentTask' });
    Task.hasMany(models.Task, { foreignKey: 'parentTaskId', as: 'subtasks' });
    Task.hasMany(models.TimeEntry, { foreignKey: 'taskId', as: 'timeEntries' });
  };

  installVisibilityGuard(Task);

  return Task;
};

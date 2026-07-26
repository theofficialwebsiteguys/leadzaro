const { DataTypes } = require('sequelize');

// A per-project role slot — distinct from a user's global employee role
// (server/core/authorization/catalog.js EMPLOYEE_ROLES). One user may
// hold multiple slots on one project (architecture § 10: "one employee
// filling several roles"); one slot may also be filled by more than one
// user (e.g. two developers).
const ROLE_SLOTS = ['owner', 'project_manager', 'designer', 'advanced_designer', 'developer', 'support', 'billing'];

module.exports = (sequelize) => {
  const ProjectAssignment = sequelize.define('ProjectAssignment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    roleSlot: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: { isIn: [ROLE_SLOTS] },
    },
    assignedByUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['projectId', 'userId', 'roleSlot'],
        name: 'project_assignments_unique_slot',
      },
    ],
  });

  ProjectAssignment.ROLE_SLOTS = ROLE_SLOTS;

  ProjectAssignment.associate = (models) => {
    ProjectAssignment.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    ProjectAssignment.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return ProjectAssignment;
};

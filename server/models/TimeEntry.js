const { DataTypes } = require('sequelize');

// Not guarded (unlike Task): time entries are never reachable by any
// client-facing route in this phase (architecture § 10 lists time
// tracking under employee workload/capacity, not client visibility).
module.exports = (sequelize) => {
  const TimeEntry = sequelize.define('TimeEntry', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    taskId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    minutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    loggedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });

  TimeEntry.associate = (models) => {
    TimeEntry.belongsTo(models.Task, { foreignKey: 'taskId', as: 'task' });
    TimeEntry.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return TimeEntry;
};

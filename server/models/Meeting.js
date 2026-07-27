const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['requested', 'confirmed', 'declined', 'cancelled'];

module.exports = (sequelize) => {
  const Meeting = sequelize.define('Meeting', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    requestedByUserId: { type: DataTypes.UUID, allowNull: false },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'requested', validate: { isIn: [STATUSES] },
    },
    subject: { type: DataTypes.STRING(255), allowNull: false },
    proposedSlots: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: [],
    },
    confirmedSlot: { type: DataTypes.JSONB, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true },
    googleCalendarEventId: { type: DataTypes.STRING(255), allowNull: true },
  });

  Meeting.STATUSES = STATUSES;

  Meeting.associate = (models) => {
    Meeting.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    Meeting.belongsTo(models.User, { foreignKey: 'requestedByUserId', as: 'requestedBy' });
  };

  installVisibilityGuard(Meeting);

  return Meeting;
};

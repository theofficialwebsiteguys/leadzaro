const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['requested', 'confirmed', 'withdrawn'];
const INITIATED_BY_VALUES = ['client', 'agency'];

module.exports = (sequelize) => {
  const CancellationRequest = sequelize.define('CancellationRequest', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    initiatedBy: {
      type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [INITIATED_BY_VALUES] },
    },
    requestedByUserId: { type: DataTypes.UUID, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'requested', validate: { isIn: [STATUSES] },
    },
    confirmedByUserId: { type: DataTypes.UUID, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true },
    withdrawnByUserId: { type: DataTypes.UUID, allowNull: true },
    withdrawnAt: { type: DataTypes.DATE, allowNull: true },
  });

  CancellationRequest.STATUSES = STATUSES;
  CancellationRequest.INITIATED_BY_VALUES = INITIATED_BY_VALUES;

  CancellationRequest.associate = (models) => {
    CancellationRequest.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    CancellationRequest.belongsTo(models.User, { foreignKey: 'requestedByUserId', as: 'requestedBy' });
  };

  installVisibilityGuard(CancellationRequest);

  return CancellationRequest;
};

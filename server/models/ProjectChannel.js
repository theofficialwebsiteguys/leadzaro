const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const VISIBILITIES = ['client', 'internal'];

module.exports = (sequelize) => {
  const ProjectChannel = sequelize.define('ProjectChannel', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    organizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    agencyOrganizationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    key: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    // 'client': both the agency and the client organization participate.
    // 'internal': employee-only — "client-hidden project channels and
    // notes" (architecture § 11). This is THE field the major gate's
    // "internal notes" language is actually about.
    visibility: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'internal',
      validate: { isIn: [VISIBILITIES] },
    },
  }, {
    indexes: [
      { unique: true, fields: ['projectId', 'key'], name: 'project_channels_unique_key' },
    ],
  });

  ProjectChannel.VISIBILITIES = VISIBILITIES;

  ProjectChannel.associate = (models) => {
    ProjectChannel.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    ProjectChannel.hasMany(models.Message, { foreignKey: 'channelId', as: 'messages' });
  };

  installVisibilityGuard(ProjectChannel);

  return ProjectChannel;
};

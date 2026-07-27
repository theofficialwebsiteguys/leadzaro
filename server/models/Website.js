const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STARTING_MODES = ['template', 'page_kit', 'guided', 'blank'];

module.exports = (sequelize) => {
  const Website = sequelize.define('Website', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: {
      type: DataTypes.UUID, allowNull: false, unique: true,
    },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    designSystemId: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(150), allowNull: false },
    startingMode: {
      type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [STARTING_MODES] },
    },
    draftSchema: {
      type: DataTypes.JSONB, allowNull: false, defaultValue: {},
    },
    currentPublishedVersionId: { type: DataTypes.UUID, allowNull: true },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  });

  Website.STARTING_MODES = STARTING_MODES;

  Website.associate = (models) => {
    Website.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    Website.belongsTo(models.DesignSystem, { foreignKey: 'designSystemId', as: 'designSystem' });
  };

  installVisibilityGuard(Website);

  return Website;
};

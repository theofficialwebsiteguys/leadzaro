const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

module.exports = (sequelize) => {
  const ClientNote = sequelize.define('ClientNote', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    projectId: { type: DataTypes.UUID, allowNull: true },
    authorUserId: { type: DataTypes.UUID, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
  });

  ClientNote.associate = (models) => {
    ClientNote.belongsTo(models.Organization, { foreignKey: 'organizationId', as: 'organization' });
    ClientNote.belongsTo(models.Project, { foreignKey: 'projectId', as: 'project' });
    ClientNote.belongsTo(models.User, { foreignKey: 'authorUserId', as: 'author' });
  };

  installVisibilityGuard(ClientNote);

  return ClientNote;
};

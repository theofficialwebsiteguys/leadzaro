const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUS_CODES = [301, 302];

module.exports = (sequelize) => {
  const WebsiteRedirect = sequelize.define('WebsiteRedirect', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    fromPath: { type: DataTypes.STRING(500), allowNull: false },
    toPath: { type: DataTypes.STRING(500), allowNull: false },
    // Stored for a future real server-level redirect (an .htaccess/
    // cPanel-level rule, pending live cPanel credentials — the same
    // deferral precedent as Phase 7's Live CPanelAdapter.uploadBuild).
    // The generator's own client-side Angular redirect (this slice) is
    // real and functions today regardless of statusCode, since a
    // client-side router redirect has no HTTP status code of its own.
    statusCode: {
      type: DataTypes.INTEGER, allowNull: false, defaultValue: 301, validate: { isIn: [STATUS_CODES] },
    },
    createdByUserId: { type: DataTypes.UUID, allowNull: true },
  }, {
    indexes: [{ unique: true, fields: ['websiteId', 'fromPath'] }],
  });

  WebsiteRedirect.STATUS_CODES = STATUS_CODES;

  WebsiteRedirect.associate = (models) => {
    WebsiteRedirect.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
  };

  installVisibilityGuard(WebsiteRedirect);

  return WebsiteRedirect;
};

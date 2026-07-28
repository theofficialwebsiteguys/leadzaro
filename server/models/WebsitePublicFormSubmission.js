const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const STATUSES = ['pending_review', 'converted', 'discarded', 'spam'];

module.exports = (sequelize) => {
  const WebsitePublicFormSubmission = sequelize.define('WebsitePublicFormSubmission', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    websiteVersionId: { type: DataTypes.UUID, allowNull: false },
    pageId: { type: DataTypes.STRING(255), allowNull: false },
    sectionId: { type: DataTypes.STRING(255), allowNull: false },
    values: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending_review', validate: { isIn: [STATUSES] },
    },
    convertedToClientRequestId: { type: DataTypes.UUID, allowNull: true },
  });

  WebsitePublicFormSubmission.STATUSES = STATUSES;

  WebsitePublicFormSubmission.associate = (models) => {
    WebsitePublicFormSubmission.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
    WebsitePublicFormSubmission.belongsTo(models.WebsiteVersion, { foreignKey: 'websiteVersionId', as: 'websiteVersion' });
    WebsitePublicFormSubmission.belongsTo(models.ClientRequest, { foreignKey: 'convertedToClientRequestId', as: 'convertedToClientRequest' });
  };

  installVisibilityGuard(WebsitePublicFormSubmission);

  return WebsitePublicFormSubmission;
};

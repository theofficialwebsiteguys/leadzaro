const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const ROBOTS_DIRECTIVES = ['index,follow', 'noindex,follow', 'index,nofollow', 'noindex,nofollow'];

module.exports = (sequelize) => {
  const WebsitePageSeoSettings = sequelize.define('WebsitePageSeoSettings', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    // Deliberately NOT versioned/tied to a WebsiteVersion — current,
    // frequently-updated operational data, not design content (current-
    // phase-plan.md § 2b). Consumers always iterate the live draft
    // schema's own page list and left-join against this table, so a
    // row for a since-deleted page is simply never surfaced — no
    // explicit orphan cleanup needed.
    pageId: { type: DataTypes.STRING(255), allowNull: false },
    metaTitle: { type: DataTypes.STRING(255), allowNull: true },
    metaDescription: { type: DataTypes.STRING(500), allowNull: true },
    canonicalUrl: { type: DataTypes.STRING(500), allowNull: true },
    robotsDirective: {
      type: DataTypes.STRING(20), allowNull: false, defaultValue: 'index,follow', validate: { isIn: [ROBOTS_DIRECTIVES] },
    },
    schemaJson: { type: DataTypes.JSONB, allowNull: true },
    updatedByUserId: { type: DataTypes.UUID, allowNull: true },
  }, {
    indexes: [{ unique: true, fields: ['websiteId', 'pageId'] }],
  });

  WebsitePageSeoSettings.ROBOTS_DIRECTIVES = ROBOTS_DIRECTIVES;

  WebsitePageSeoSettings.associate = (models) => {
    WebsitePageSeoSettings.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
  };

  installVisibilityGuard(WebsitePageSeoSettings);

  return WebsitePageSeoSettings;
};

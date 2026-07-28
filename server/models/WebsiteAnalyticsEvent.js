const { DataTypes } = require('sequelize');
const { installVisibilityGuard } = require('../core/authorization/visibilityGuard');

const EVENT_TYPES = ['page_view', 'click', 'scroll_depth', 'outbound_link_click', 'form_view'];

module.exports = (sequelize) => {
  const WebsiteAnalyticsEvent = sequelize.define('WebsiteAnalyticsEvent', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    websiteId: { type: DataTypes.UUID, allowNull: false },
    organizationId: { type: DataTypes.UUID, allowNull: false },
    agencyOrganizationId: { type: DataTypes.UUID, allowNull: false },
    eventType: {
      type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [EVENT_TYPES] },
    },
    path: { type: DataTypes.STRING(500), allowNull: true },
    // Anonymous, client-generated (e.g. a random id stored in
    // sessionStorage by the generated site) — never a real user id, no
    // PII, no cross-site tracking.
    sessionId: { type: DataTypes.STRING(100), allowNull: false },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  });

  WebsiteAnalyticsEvent.EVENT_TYPES = EVENT_TYPES;

  WebsiteAnalyticsEvent.associate = (models) => {
    WebsiteAnalyticsEvent.belongsTo(models.Website, { foreignKey: 'websiteId', as: 'website' });
  };

  installVisibilityGuard(WebsiteAnalyticsEvent);

  return WebsiteAnalyticsEvent;
};

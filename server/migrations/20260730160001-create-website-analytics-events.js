'use strict';

/**
 * Phase 7 slice 7 (current-phase-plan.md § 2d). Written by anonymous
 * public traffic via the same no-requester-context write pattern as
 * WebsitePublicFormSubmission (slice 6) — raw rows stay employee-only
 * (assertEmployeeContextForAnalytics); a separate tenant-scoped
 * aggregate accessor (getWebsiteAnalyticsSummaryForRequester) is
 * reachable by both employees and clients, satisfying architecture §
 * 19's "client dashboards show business-focused summaries" requirement
 * without exposing raw session-level rows (review finding #7).
 * googleAnalyticsMeasurementId added to Websites in this same
 * migration — the guided Google Analytics connection is a single
 * employee-settable field, never a provisioned account.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteAnalyticsEvents', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      websiteId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Websites', key: 'id' }, onDelete: 'CASCADE',
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      eventType: { type: Sequelize.STRING(30), allowNull: false },
      path: { type: Sequelize.STRING(500), allowNull: true },
      sessionId: { type: Sequelize.STRING(100), allowNull: false },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteAnalyticsEvents', ['agencyOrganizationId']);
    await queryInterface.addIndex('WebsiteAnalyticsEvents', ['websiteId', 'createdAt']);

    await queryInterface.addColumn('Websites', 'googleAnalyticsMeasurementId', { type: Sequelize.STRING(50), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Websites', 'googleAnalyticsMeasurementId');
    await queryInterface.dropTable('WebsiteAnalyticsEvents');
  },
};

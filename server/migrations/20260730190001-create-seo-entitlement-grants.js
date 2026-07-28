'use strict';

/**
 * Phase 8 slice 1 (current-phase-plan.md § 2a). The manual half of SEO
 * entitlement resolution — the real, billing-driven half reuses
 * Subscription.addOnServicePlanIds directly, no new table needed for
 * that. Employee-only (installVisibilityGuard); revocation is a
 * status-flip (revokedAt/revokedByUserId) rather than a delete, so a
 * past grant's own history — who granted it, why, when it was revoked
 * and by whom — is never lost.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SeoEntitlementGrants', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      grantedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      reason: { type: Sequelize.TEXT, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      revokedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('SeoEntitlementGrants', ['agencyOrganizationId']);
    await queryInterface.addIndex('SeoEntitlementGrants', ['organizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('SeoEntitlementGrants');
  },
};

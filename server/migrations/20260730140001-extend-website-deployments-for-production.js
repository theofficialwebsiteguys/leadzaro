'use strict';

/**
 * Phase 7 slices 3-4 (current-phase-plan.md § 2b/2c). `status` gains
 * 'rolled_back'/'rollback_failed' (app-level validate: isIn, no DB
 * check constraint to alter). `previousLiveDeploymentId` (self-
 * referential, nullable) snapshots Website.currentLiveProductionDeploymentId
 * at the moment each production attempt started; `backupRef` is the
 * cPanel adapter's own backup id for that attempt. Website gains
 * currentLiveProductionDeploymentId — an explicit pointer, set only on
 * a successful production deploy, never mutated on failure/rollback
 * (review finding #4 — never mutate a WebsiteDeployment row after
 * creation; "current" is derived from this pointer instead).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('WebsiteDeployments', 'previousLiveDeploymentId', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'WebsiteDeployments', key: 'id' },
    });
    await queryInterface.addColumn('WebsiteDeployments', 'backupRef', { type: Sequelize.STRING(255), allowNull: true });

    await queryInterface.addColumn('Websites', 'currentLiveProductionDeploymentId', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'WebsiteDeployments', key: 'id' },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Websites', 'currentLiveProductionDeploymentId');
    await queryInterface.removeColumn('WebsiteDeployments', 'backupRef');
    await queryInterface.removeColumn('WebsiteDeployments', 'previousLiveDeploymentId');
  },
};

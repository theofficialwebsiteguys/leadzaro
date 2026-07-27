'use strict';

/**
 * Phase 4 slice 8 (current-phase-plan.md § 5 item 8, corrected § 2b
 * item 4: CancellationRequest needs an explicit initiatedBy ('client'|
 * 'agency') field — the workflow is client-initiated in the common
 * case, but the state machine must also allow the agency to initiate
 * (e.g. non-payment, scope mismatch) and record who actually drove a
 * given request). No client/internal visibility split — same reasoning
 * as ClientRequest/Meeting: a cancellation request is inherently
 * visible to both the client and the agency handling the project.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CancellationRequests', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      projectId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      initiatedBy: { type: Sequelize.STRING(10), allowNull: false },
      requestedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      reason: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'requested' },
      confirmedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      confirmedAt: { type: Sequelize.DATE, allowNull: true },
      withdrawnByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      withdrawnAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('CancellationRequests', ['projectId']);
    await queryInterface.addIndex('CancellationRequests', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('CancellationRequests');
  },
};

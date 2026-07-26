'use strict';

/**
 * Phase 4 slice 4 (current-phase-plan.md § 5 item 4). Both tables
 * denormalize organizationId/agencyOrganizationId (same reasoning as
 * Task/Message). Unlike Task/ProjectChannel, there is no separate
 * client/internal visibility flag here — every ClientRequest a client
 * submits is inherently visible to both them and the agency; the guard
 * still matters for cross-tenant isolation (client-org and agency
 * scoping), just not a client/internal split.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ClientRequests', {
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
      category: { type: Sequelize.STRING(30), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      submittedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'queued' },
      convertedToTaskId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Tasks', key: 'id' },
      },
      estimatedMinutes: { type: Sequelize.INTEGER, allowNull: true },
      actualMinutes: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ClientRequests', ['projectId']);
    await queryInterface.addIndex('ClientRequests', ['agencyOrganizationId']);
    await queryInterface.addIndex('ClientRequests', ['organizationId']);

    await queryInterface.createTable('ContentInboxItems', {
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
      type: { type: Sequelize.STRING(20), allowNull: false },
      body: { type: Sequelize.TEXT, allowNull: false },
      submittedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'new' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ContentInboxItems', ['projectId']);
    await queryInterface.addIndex('ContentInboxItems', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ContentInboxItems');
    await queryInterface.dropTable('ClientRequests');
  },
};

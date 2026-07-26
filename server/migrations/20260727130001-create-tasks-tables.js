'use strict';

/**
 * Phase 4 slice 2 (see docs/leadzaro/current-phase-plan.md § 5, item 2).
 * Task denormalizes both organizationId and agencyOrganizationId
 * directly (rather than resolving through Project via an `include`),
 * matching the established codebase-wide pattern (Opportunity, Contact,
 * Location, ...) and specifically avoiding ADR 0007's documented
 * "included association bypasses the guard hook" gap — Task's own
 * top-level query can be scoped directly without ever needing to
 * `include` the guarded Project model.
 *
 * `isClientVisible` defaults to false — a task is internal by default
 * and must be explicitly marked client-visible, the safer default
 * direction for the phase's major gate.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Tasks', {
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
      parentTaskId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Tasks', key: 'id' }, onDelete: 'CASCADE',
      },
      title: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      assigneeUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      status: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'todo',
      },
      priority: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium',
      },
      dueDate: { type: Sequelize.DATEONLY, allowNull: true },
      estimateMinutes: { type: Sequelize.INTEGER, allowNull: true },
      position: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      tags: {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      },
      isClientVisible: {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      },
      archivedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Tasks', ['projectId']);
    await queryInterface.addIndex('Tasks', ['agencyOrganizationId']);
    await queryInterface.addIndex('Tasks', ['organizationId']);

    await queryInterface.createTable('TimeEntries', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      taskId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Tasks', key: 'id' }, onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      minutes: { type: Sequelize.INTEGER, allowNull: false },
      note: { type: Sequelize.TEXT, allowNull: true },
      loggedAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('TimeEntries', ['taskId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TimeEntries');
    await queryInterface.dropTable('Tasks');
  },
};

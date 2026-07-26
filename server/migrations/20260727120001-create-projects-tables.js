'use strict';

/**
 * Phase 4 (roadmap: "Agency Operations and Website Guys Client Portal").
 * See docs/leadzaro/current-phase-plan.md for the full design, corrected
 * by an independent architecture review before this migration was
 * written, and docs/leadzaro/adr/0007-client-visibility-enforcement.md
 * for the client-visibility enforcement decision these tables are built
 * around.
 *
 * ProjectFinancials is deliberately a separate one-to-one table, never
 * columns on Projects itself — the major gate names "financial margins"
 * explicitly, and a flag can only protect a row, not a field; Project
 * rows themselves must be client-visible.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Projects', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      ownerUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      stage: {
        type: Sequelize.STRING(40), allowNull: false, defaultValue: 'Client Onboarding',
      },
      healthStatus: {
        type: Sequelize.STRING(20), allowNull: false, defaultValue: 'on_track',
      },
      healthStatusIsManualOverride: {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      },
      launchedAt: { type: Sequelize.DATE, allowNull: true },
      cancellationRequestedAt: { type: Sequelize.DATE, allowNull: true },
      sourceConversionAttemptId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'ConversionAttempts', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Projects', ['agencyOrganizationId']);
    // Every client Organization gets exactly one Project (Phase 4's own
    // backfill migration enforces this for pre-existing clients; this
    // constraint enforces it going forward at the database level).
    await queryInterface.addIndex('Projects', ['organizationId'], { unique: true, name: 'projects_organization_unique' });

    await queryInterface.createTable('ProjectAssignments', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      projectId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      roleSlot: { type: Sequelize.STRING(30), allowNull: false },
      assignedByUserId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ProjectAssignments', ['projectId', 'userId', 'roleSlot'], {
      unique: true, name: 'project_assignments_unique_slot',
    });

    await queryInterface.createTable('ProjectFinancials', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      projectId: {
        type: Sequelize.UUID, allowNull: false, unique: true, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
      },
      estimatedCostCents: { type: Sequelize.INTEGER, allowNull: true },
      actualCostCents: { type: Sequelize.INTEGER, allowNull: true },
      marginNotes: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ProjectFinancials');
    await queryInterface.dropTable('ProjectAssignments');
    await queryInterface.dropTable('Projects');
  },
};

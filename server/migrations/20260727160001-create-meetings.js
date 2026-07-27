'use strict';

/**
 * Phase 4 slice 5 (current-phase-plan.md § 5 item 5, corrected § 2b
 * item 3: Meeting needs its own tenant-scoping columns — every other
 * new table in this phase has one; this was the one gap the review
 * found). No client/internal visibility split — a meeting is inherently
 * visible to whoever requested it and the agency handling it, same
 * reasoning as ClientRequest.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Meetings', {
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
      requestedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'requested' },
      subject: { type: Sequelize.STRING(255), allowNull: false },
      proposedSlots: {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      },
      confirmedSlot: { type: Sequelize.JSONB, allowNull: true },
      confirmedAt: { type: Sequelize.DATE, allowNull: true },
      googleCalendarEventId: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Meetings', ['projectId']);
    await queryInterface.addIndex('Meetings', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Meetings');
  },
};

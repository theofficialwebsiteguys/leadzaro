'use strict';

/**
 * Phase 8 slice 6 (current-phase-plan.md § 2d). The unique index on
 * (websiteId, cyclePeriod) is the real idempotency guarantee — a
 * concurrent duplicate "generate this cycle" attempt fails at the
 * database level, not via a racy app-level check-then-create.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('SeoTaskCycles', {
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
      cyclePeriod: { type: Sequelize.STRING(7), allowNull: false },
      generatedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('SeoTaskCycles', ['agencyOrganizationId']);
    await queryInterface.addIndex('SeoTaskCycles', ['websiteId', 'cyclePeriod'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('SeoTaskCycles');
  },
};

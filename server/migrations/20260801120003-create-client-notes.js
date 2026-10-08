'use strict';

/**
 * A shared, append-only internal notes feed per client. `projectId` is
 * optional: a note can be about the client as a whole or about one of
 * its projects, and both show up in the client's feed. Agency-only —
 * never visible to a client membership.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ClientNotes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      projectId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Projects', key: 'id' }, onDelete: 'CASCADE',
      },
      authorUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ClientNotes', ['organizationId']);
    await queryInterface.addIndex('ClientNotes', ['projectId']);
    await queryInterface.addIndex('ClientNotes', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ClientNotes');
  },
};

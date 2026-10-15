'use strict';

/**
 * Per-user mailbox connections (ADR 0015): each employee connects their own
 * Google Workspace mailbox so sales email is sent as them. Only the
 * encrypted refresh token and the verified address are stored.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const {
      UUID, STRING, TEXT, DATE, NOW,
    } = Sequelize;
    await queryInterface.createTable('UserMailboxConnections', {
      id: { type: UUID, primaryKey: true, defaultValue: Sequelize.literal('gen_random_uuid()') },
      userId: {
        type: UUID, allowNull: false, references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
      },
      provider: { type: STRING(20), allowNull: false, defaultValue: 'gmail' },
      email: { type: STRING(255), allowNull: false },
      scopes: { type: TEXT, allowNull: true },
      status: { type: STRING(20), allowNull: false, defaultValue: 'connected' },
      refreshTokenCiphertext: { type: TEXT, allowNull: false },
      connectedAt: { type: DATE, allowNull: false, defaultValue: NOW },
      lastUsedAt: { type: DATE, allowNull: true },
      lastErrorMessage: { type: STRING(500), allowNull: true },
      lastErrorAt: { type: DATE, allowNull: true },
      createdAt: { type: DATE, allowNull: false, defaultValue: NOW },
      updatedAt: { type: DATE, allowNull: false, defaultValue: NOW },
    });
    await queryInterface.addIndex('UserMailboxConnections', ['userId', 'agencyOrganizationId', 'provider'], { unique: true, name: 'user_mailbox_connections_user_agency_provider' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserMailboxConnections');
  },
};

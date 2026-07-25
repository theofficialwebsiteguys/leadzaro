'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Invitations', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
        onDelete: 'CASCADE',
      },
      email: { type: Sequelize.STRING(255), allowNull: false },
      membershipType: { type: Sequelize.STRING(20), allowNull: false },
      roleKeys: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      tokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      invitedByUserId: { type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' } },
      acceptedByUserId: { type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' } },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      acceptedAt: { type: Sequelize.DATE, allowNull: true },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      revokedByUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Invitations', ['organizationId', 'email', 'status']);

    await queryInterface.createTable('AuthSessions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
      },
      tokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      userAgent: { type: Sequelize.STRING(255), allowNull: true },
      ipAddress: { type: Sequelize.STRING(64), allowNull: true },
      lastSeenAt: { type: Sequelize.DATE, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      revokedByUserId: { type: Sequelize.UUID, allowNull: true },
      revokedReason: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('AuthSessions', ['userId']);

    await queryInterface.createTable('AuditLogs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: { type: Sequelize.UUID, allowNull: true, references: { model: 'Organizations', key: 'id' } },
      actorUserId: { type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' } },
      action: { type: Sequelize.STRING(80), allowNull: false },
      targetType: { type: Sequelize.STRING(60), allowNull: true },
      targetId: { type: Sequelize.STRING(64), allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: true },
      ipAddress: { type: Sequelize.STRING(64), allowNull: true },
      requestId: { type: Sequelize.STRING(64), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('AuditLogs', ['organizationId', 'createdAt']);
    await queryInterface.addIndex('AuditLogs', ['actorUserId']);
    await queryInterface.addIndex('AuditLogs', ['targetType', 'targetId']);

    await queryInterface.createTable('Notifications', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
      },
      organizationId: { type: Sequelize.UUID, allowNull: true, references: { model: 'Organizations', key: 'id' } },
      type: { type: Sequelize.STRING(60), allowNull: false },
      title: { type: Sequelize.STRING(200), allowNull: false },
      body: { type: Sequelize.TEXT, allowNull: true },
      data: { type: Sequelize.JSONB, allowNull: true },
      readAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Notifications', ['userId', 'readAt']);

    await queryInterface.createTable('NotificationPreferences', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
      },
      category: { type: Sequelize.STRING(60), allowNull: false },
      channel: { type: Sequelize.STRING(20), allowNull: false },
      frequency: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'immediate' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('NotificationPreferences', ['userId', 'category', 'channel'], {
      unique: true,
      name: 'notification_preferences_user_category_channel_unique',
    });

    await queryInterface.createTable('PasswordResetTokens', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
      },
      tokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      usedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('EmailVerificationTokens', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
      },
      tokenHash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      usedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('EmailVerificationTokens');
    await queryInterface.dropTable('PasswordResetTokens');
    await queryInterface.dropTable('NotificationPreferences');
    await queryInterface.dropTable('Notifications');
    await queryInterface.dropTable('AuditLogs');
    await queryInterface.dropTable('AuthSessions');
    await queryInterface.dropTable('Invitations');
  },
};

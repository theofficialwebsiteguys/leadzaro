'use strict';

/**
 * Phase 5 slice 7 (current-phase-plan.md § 2h/2i). Three tables, every
 * one denormalizing organizationId/agencyOrganizationId directly like
 * every other Phase 5 child table.
 *
 * WebsiteComment ("visual feedback anchored to versions/components" —
 * architecture § 14 / roadmap): anchorKey is a path into the schema
 * (mirrors WebsiteEditLock.sectionKey), not an FK, since sections aren't
 * normalized rows (§ 2b). isInternal mirrors ProjectChannel's client/
 * internal split so employees can leave client-invisible notes.
 *
 * WebsiteEditLock / WebsitePresence: short-TTL, heartbeat-renewed rows
 * for collaboration UX — a lock past expiresAt is simply treated as
 * available at read/acquire time, no cleanup job needed (no such
 * infrastructure exists in this codebase); a presence row is "current"
 * only if lastSeenAt is within a short recency window, filtered at read
 * time the same way.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('WebsiteComments', {
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
      versionId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'WebsiteVersions', key: 'id' },
      },
      anchorKey: { type: Sequelize.STRING(255), allowNull: false },
      authorUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      isInternal: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      resolvedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteComments', ['websiteId']);
    await queryInterface.addIndex('WebsiteComments', ['agencyOrganizationId']);

    await queryInterface.createTable('WebsiteEditLocks', {
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
      sectionKey: { type: Sequelize.STRING(255), allowNull: false },
      lockedByUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      lockedAt: { type: Sequelize.DATE, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsiteEditLocks', ['websiteId']);
    await queryInterface.addConstraint('WebsiteEditLocks', {
      fields: ['websiteId', 'sectionKey'],
      type: 'unique',
      name: 'website_edit_locks_website_id_section_key_unique',
    });

    await queryInterface.createTable('WebsitePresences', {
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
      userId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      sectionKey: { type: Sequelize.STRING(255), allowNull: true },
      lastSeenAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('WebsitePresences', ['websiteId']);
    await queryInterface.addConstraint('WebsitePresences', {
      fields: ['websiteId', 'userId'],
      type: 'unique',
      name: 'website_presences_website_id_user_id_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('WebsitePresences');
    await queryInterface.dropTable('WebsiteEditLocks');
    await queryInterface.dropTable('WebsiteComments');
  },
};

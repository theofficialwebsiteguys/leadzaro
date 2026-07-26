'use strict';

/**
 * Phase 4 slice 3 (current-phase-plan.md § 5 item 3) — the highest-risk
 * client-visibility case in this phase: ProjectChannel.visibility
 * distinguishes the 7 named collaboration channels (architecture § 11:
 * General Project, Content and Assets, Design Feedback, Development
 * Questions, Billing, Launch and Domains, Ongoing Support — all
 * `visibility: 'client'`, meaning both the client and the agency
 * participate) from one additional employee-only "Internal Notes"
 * channel seeded per project (`visibility: 'internal'` — "employees
 * also have client-hidden project channels and notes").
 *
 * Both tables denormalize organizationId/agencyOrganizationId directly
 * (never resolved via an `include` of the guarded Project model), same
 * reasoning as Task in slice 2.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ProjectChannels', {
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
      key: { type: Sequelize.STRING(30), allowNull: false },
      name: { type: Sequelize.STRING(100), allowNull: false },
      visibility: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'internal' },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ProjectChannels', ['projectId']);
    await queryInterface.addIndex('ProjectChannels', ['agencyOrganizationId']);
    await queryInterface.addIndex('ProjectChannels', ['projectId', 'key'], { unique: true, name: 'project_channels_unique_key' });

    await queryInterface.createTable('Messages', {
      id: {
        type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true,
      },
      channelId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'ProjectChannels', key: 'id' }, onDelete: 'CASCADE',
      },
      // Denormalized for the same reason as ProjectChannel's own columns
      // — a Message's own top-level query never needs to `include`
      // ProjectChannel (which is itself not a guarded model, but Project
      // still must never be included anywhere).
      organizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      agencyOrganizationId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' },
      },
      authorUserId: {
        type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' },
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      attachments: {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      },
      mentionedUserIds: {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      },
      threadParentMessageId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Messages', key: 'id' },
      },
      convertedToTaskId: {
        type: Sequelize.UUID, allowNull: true, references: { model: 'Tasks', key: 'id' },
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Messages', ['channelId']);
    await queryInterface.addIndex('Messages', ['agencyOrganizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Messages');
    await queryInterface.dropTable('ProjectChannels');
  },
};

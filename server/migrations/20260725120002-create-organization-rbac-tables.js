'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Organizations', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING(150), allowNull: false },
      slug: { type: Sequelize.STRING(180), allowNull: false, unique: true },
      type: { type: Sequelize.STRING(20), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' },
      branding: { type: Sequelize.JSONB, allowNull: true },
      archivedAt: { type: Sequelize.DATE, allowNull: true },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      deletedByUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('OrganizationMemberships', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
        onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onDelete: 'CASCADE',
      },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'invited' },
      membershipType: { type: Sequelize.STRING(20), allowNull: false },
      title: { type: Sequelize.STRING(150), allowNull: true },
      invitedAt: { type: Sequelize.DATE, allowNull: true },
      acceptedAt: { type: Sequelize.DATE, allowNull: true },
      archivedAt: { type: Sequelize.DATE, allowNull: true },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('OrganizationMemberships', ['organizationId', 'userId'], {
      unique: true,
      name: 'organization_memberships_org_user_unique',
    });
    await queryInterface.addIndex('OrganizationMemberships', ['userId']);

    await queryInterface.createTable('Roles', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      key: { type: Sequelize.STRING(60), allowNull: false, unique: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      scope: { type: Sequelize.STRING(20), allowNull: false },
      isSystem: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      description: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('Permissions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      key: { type: Sequelize.STRING(80), allowNull: false, unique: true },
      category: { type: Sequelize.STRING(40), allowNull: true },
      description: { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('RolePermissions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      roleId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Roles', key: 'id' },
        onDelete: 'CASCADE',
      },
      permissionId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Permissions', key: 'id' },
        onDelete: 'CASCADE',
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('RolePermissions', ['roleId', 'permissionId'], {
      unique: true,
      name: 'role_permissions_role_permission_unique',
    });

    await queryInterface.createTable('MembershipRoles', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      membershipId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'OrganizationMemberships', key: 'id' },
        onDelete: 'CASCADE',
      },
      roleId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Roles', key: 'id' },
        onDelete: 'CASCADE',
      },
      assignedByUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('MembershipRoles', ['membershipId', 'roleId'], {
      unique: true,
      name: 'membership_roles_membership_role_unique',
    });

    await queryInterface.createTable('MembershipPermissionOverrides', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      membershipId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'OrganizationMemberships', key: 'id' },
        onDelete: 'CASCADE',
      },
      permissionId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Permissions', key: 'id' },
        onDelete: 'CASCADE',
      },
      effect: { type: Sequelize.STRING(10), allowNull: false },
      reason: { type: Sequelize.STRING(255), allowNull: true },
      createdByUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('MembershipPermissionOverrides', ['membershipId', 'permissionId'], {
      unique: true,
      name: 'membership_permission_overrides_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('MembershipPermissionOverrides');
    await queryInterface.dropTable('MembershipRoles');
    await queryInterface.dropTable('RolePermissions');
    await queryInterface.dropTable('Permissions');
    await queryInterface.dropTable('Roles');
    await queryInterface.dropTable('OrganizationMemberships');
    await queryInterface.dropTable('Organizations');
  },
};

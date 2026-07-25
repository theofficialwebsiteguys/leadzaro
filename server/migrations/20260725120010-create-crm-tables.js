'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Opportunities', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
        onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
      },
      sourceLeadId: { type: Sequelize.UUID, allowNull: true, references: { model: 'Leads', key: 'id' } },
      stage: { type: Sequelize.STRING(40), allowNull: false },
      assignedToUserId: { type: Sequelize.UUID, allowNull: true },
      score: { type: Sequelize.INTEGER, allowNull: true },
      scoreReason: { type: Sequelize.STRING(255), allowNull: true },
      archivedAt: { type: Sequelize.DATE, allowNull: true },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      deletedByUserId: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Opportunities', ['agencyOrganizationId', 'sourceLeadId'], {
      unique: true,
      where: { archivedAt: null, deletedAt: null },
      name: 'opportunities_agency_lead_active_unique',
    });
    await queryInterface.addIndex('Opportunities', ['agencyOrganizationId']);
    await queryInterface.addIndex('Opportunities', ['organizationId']);
    await queryInterface.addIndex('Opportunities', ['assignedToUserId']);

    await queryInterface.createTable('Contacts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
        onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
      },
      name: { type: Sequelize.STRING(150), allowNull: false },
      title: { type: Sequelize.STRING(150), allowNull: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      phone: { type: Sequelize.STRING(50), allowNull: true },
      source: { type: Sequelize.STRING(50), allowNull: true },
      isPrimary: { type: Sequelize.BOOLEAN, defaultValue: false },
      archivedAt: { type: Sequelize.DATE, allowNull: true },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Contacts', ['agencyOrganizationId']);
    await queryInterface.addIndex('Contacts', ['organizationId']);

    await queryInterface.createTable('Locations', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      organizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
        onDelete: 'CASCADE',
      },
      agencyOrganizationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'Organizations', key: 'id' },
      },
      label: { type: Sequelize.STRING(100), allowNull: true },
      address: { type: Sequelize.STRING(255), allowNull: true },
      city: { type: Sequelize.STRING(100), allowNull: true },
      state: { type: Sequelize.STRING(100), allowNull: true },
      zip: { type: Sequelize.STRING(20), allowNull: true },
      phone: { type: Sequelize.STRING(50), allowNull: true },
      latitude: { type: Sequelize.DECIMAL(10, 8), allowNull: true },
      longitude: { type: Sequelize.DECIMAL(11, 8), allowNull: true },
      isPrimary: { type: Sequelize.BOOLEAN, defaultValue: true },
      archivedAt: { type: Sequelize.DATE, allowNull: true },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('Locations', ['agencyOrganizationId']);
    await queryInterface.addIndex('Locations', ['organizationId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Locations');
    await queryInterface.dropTable('Contacts');
    await queryInterface.dropTable('Opportunities');
  },
};

'use strict';

/**
 * Hosting plans and actual payments (ADR 0009). Namecheap's API has no
 * hosting or payment-history commands, so both are maintained by hand.
 *
 * HostingPlans — a plan's total cost is stored once, with an explicit
 * allocationMethod: 'equal' (split evenly across the clients on it),
 * 'manual' (amounts per client in HostingPlanClients.allocatedCents) or
 * 'none' (agency overhead, not charged against any client). Totals count
 * the plan once and a client only its share, so shared hosting is never
 * counted in full for every client.
 *
 * HostingPlanClients — one row per client on a plan, with the specific
 * projects that use it (empty = the client as a whole).
 *
 * ServiceExpenses — what was actually paid, entered by hand, for either a
 * domain registration or a hosting plan. Never derived from catalog
 * prices; an amount is always required, so "unknown" is simply no row.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const noticeColumns = {
        expiryNoticeLevel: { type: Sequelize.STRING(10), allowNull: true },
        expiryNoticeForDate: { type: Sequelize.DATEONLY, allowNull: true },
      };
      await queryInterface.createTable('HostingPlans', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        agencyOrganizationId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
        },
        name: { type: Sequelize.STRING(150), allowNull: false },
        providerName: { type: Sequelize.STRING(100), allowNull: true },
        planName: { type: Sequelize.STRING(100), allowNull: true },
        controlPanelUrl: { type: Sequelize.STRING(500), allowNull: true },
        costCents: { type: Sequelize.INTEGER, allowNull: true },
        currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
        billingPeriodMonths: { type: Sequelize.INTEGER, allowNull: true },
        expiresOn: { type: Sequelize.DATEONLY, allowNull: true },
        nextChargeOn: { type: Sequelize.DATEONLY, allowNull: true },
        autoRenew: { type: Sequelize.BOOLEAN, allowNull: true },
        allocationMethod: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'equal' },
        notes: { type: Sequelize.TEXT, allowNull: true },
        archivedAt: { type: Sequelize.DATE, allowNull: true },
        ...noticeColumns,
        createdByUserId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('HostingPlans', ['agencyOrganizationId'], { name: 'hosting_plans_agency', transaction });

      await queryInterface.createTable('HostingPlanClients', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        agencyOrganizationId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
        },
        hostingPlanId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'HostingPlans', key: 'id' }, onDelete: 'CASCADE',
        },
        organizationId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
        },
        projectIds: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
        allocatedCents: { type: Sequelize.INTEGER, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('HostingPlanClients', ['hostingPlanId', 'organizationId'], { unique: true, name: 'hosting_plan_clients_unique', transaction });
      await queryInterface.addIndex('HostingPlanClients', ['organizationId'], { name: 'hosting_plan_clients_organization', transaction });

      await queryInterface.createTable('ServiceExpenses', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        agencyOrganizationId: {
          type: Sequelize.UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE',
        },
        domainRecordId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'DomainRecords', key: 'id' }, onDelete: 'CASCADE',
        },
        hostingPlanId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'HostingPlans', key: 'id' }, onDelete: 'CASCADE',
        },
        amountCents: { type: Sequelize.INTEGER, allowNull: false },
        currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
        paidOn: { type: Sequelize.DATEONLY, allowNull: false },
        coversFrom: { type: Sequelize.DATEONLY, allowNull: true },
        coversTo: { type: Sequelize.DATEONLY, allowNull: true },
        description: { type: Sequelize.STRING(200), allowNull: true },
        createdByUserId: {
          type: Sequelize.UUID, allowNull: true, references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL',
        },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.sequelize.query(
        'ALTER TABLE "ServiceExpenses" ADD CONSTRAINT service_expenses_one_subject CHECK (("domainRecordId" IS NULL) <> ("hostingPlanId" IS NULL))',
        { transaction },
      );
      await queryInterface.addIndex('ServiceExpenses', ['domainRecordId'], { name: 'service_expenses_domain_record', transaction });
      await queryInterface.addIndex('ServiceExpenses', ['hostingPlanId'], { name: 'service_expenses_hosting_plan', transaction });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ServiceExpenses', { transaction });
      await queryInterface.dropTable('HostingPlanClients', { transaction });
      await queryInterface.dropTable('HostingPlans', { transaction });
    });
  },
};

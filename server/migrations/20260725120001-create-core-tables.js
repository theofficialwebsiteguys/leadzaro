'use strict';

/**
 * Baseline capture of the 7 tables that existed before explicit migrations
 * were introduced (they were previously created ad hoc by
 * `sequelize.sync({ alter: true })`). Every `createTable` call is guarded
 * by an existing-tables check so this migration is safe to run against:
 *   - a brand new empty database (creates everything), and
 *   - a representative legacy database that already has these tables
 *     from the old sync-based startup (skips tables that already exist).
 * Column shapes intentionally match the pre-Phase-1 model definitions;
 * Phase 1 additions (organizationId, archive/soft-delete columns, etc.)
 * are applied by a later migration so the legacy-DB migration path is
 * exercised for real.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const existing = await queryInterface.showAllTables();
    const has = (name) => existing.map((n) => n.toLowerCase()).includes(name.toLowerCase());

    if (!has('Users')) {
      await queryInterface.createTable('Users', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        name: { type: Sequelize.STRING(100), allowNull: false },
        email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
        passwordHash: { type: Sequelize.STRING, allowNull: false },
        companyName: { type: Sequelize.STRING(150), allowNull: true },
        salespersonType: {
          type: Sequelize.ENUM(
            'Website Developer', 'Marketing Agency', 'Roofing Company', 'Real Estate Agent',
            'Insurance Agent', 'Local Service Business', 'Cannabis Sales', 'Custom / Other'
          ),
          allowNull: false,
          defaultValue: 'Custom / Other',
        },
        targetIndustry: { type: Sequelize.STRING(150), allowNull: true },
        serviceArea: { type: Sequelize.STRING(200), allowNull: true },
        role: { type: Sequelize.ENUM('user', 'admin'), defaultValue: 'user' },
        isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!has('Leads')) {
      await queryInterface.createTable('Leads', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        name: { type: Sequelize.STRING(255), allowNull: false },
        category: { type: Sequelize.STRING(150), allowNull: true },
        phone: { type: Sequelize.STRING(50), allowNull: true },
        address: { type: Sequelize.STRING(255), allowNull: true },
        city: { type: Sequelize.STRING(100), allowNull: true },
        state: { type: Sequelize.STRING(100), allowNull: true },
        zip: { type: Sequelize.STRING(20), allowNull: true },
        latitude: { type: Sequelize.DECIMAL(10, 8), allowNull: true },
        longitude: { type: Sequelize.DECIMAL(11, 8), allowNull: true },
        website: { type: Sequelize.STRING(500), allowNull: true },
        hasWebsite: { type: Sequelize.BOOLEAN, defaultValue: false },
        googleMapsUrl: { type: Sequelize.STRING(500), allowNull: true },
        googlePlaceId: { type: Sequelize.STRING(255), allowNull: true, unique: true },
        rating: { type: Sequelize.DECIMAL(3, 1), allowNull: true },
        reviewCount: { type: Sequelize.INTEGER, defaultValue: 0 },
        source: { type: Sequelize.STRING(50), defaultValue: 'google_places' },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!has('SavedLeads')) {
      await queryInterface.createTable('SavedLeads', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'Users', key: 'id' } },
        leadId: { type: Sequelize.UUID, allowNull: false, references: { model: 'Leads', key: 'id' } },
        status: {
          type: Sequelize.ENUM('New', 'Saved', 'Contacted', 'Follow Up', 'Interested', 'Not Interested', 'Closed', 'Archived'),
          defaultValue: 'Saved',
        },
        priority: { type: Sequelize.ENUM('Low', 'Medium', 'High'), defaultValue: 'Medium' },
        notes: { type: Sequelize.TEXT, allowNull: true },
        lastContactedAt: { type: Sequelize.DATE, allowNull: true },
        nextFollowUpAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!has('LeadNotes')) {
      await queryInterface.createTable('LeadNotes', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: { type: Sequelize.UUID, allowNull: false },
        leadId: { type: Sequelize.UUID, allowNull: false },
        content: { type: Sequelize.TEXT, allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!has('OutreachActivities')) {
      await queryInterface.createTable('OutreachActivities', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: { type: Sequelize.UUID, allowNull: false },
        leadId: { type: Sequelize.UUID, allowNull: false },
        type: {
          type: Sequelize.ENUM('email', 'call', 'visit', 'message', 'linkedin', 'other'),
          allowNull: false,
          defaultValue: 'other',
        },
        note: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!has('SubscriptionPlans')) {
      await queryInterface.createTable('SubscriptionPlans', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        name: { type: Sequelize.ENUM('Free Trial', 'Starter', 'Pro', 'Agency'), allowNull: false },
        price: { type: Sequelize.DECIMAL(8, 2), allowNull: false, defaultValue: 0 },
        monthlySearches: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 10 },
        savedLeadsLimit: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 25 },
        exportAccess: { type: Sequelize.BOOLEAN, defaultValue: false },
        teamMembers: { type: Sequelize.INTEGER, defaultValue: 1 },
        advancedFilters: { type: Sequelize.BOOLEAN, defaultValue: false },
        isActive: { type: Sequelize.BOOLEAN, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!has('UserSubscriptions')) {
      await queryInterface.createTable('UserSubscriptions', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        userId: { type: Sequelize.UUID, allowNull: false, unique: true },
        planId: { type: Sequelize.UUID, allowNull: false },
        status: { type: Sequelize.ENUM('active', 'cancelled', 'expired', 'trialing'), defaultValue: 'trialing' },
        stripeCustomerId: { type: Sequelize.STRING, allowNull: true },
        stripeSubscriptionId: { type: Sequelize.STRING, allowNull: true },
        currentPeriodStart: { type: Sequelize.DATE, allowNull: true },
        currentPeriodEnd: { type: Sequelize.DATE, allowNull: true },
        searchesUsedThisMonth: { type: Sequelize.INTEGER, defaultValue: 0 },
        leadsUsedTotal: { type: Sequelize.INTEGER, defaultValue: 0 },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserSubscriptions');
    await queryInterface.dropTable('SubscriptionPlans');
    await queryInterface.dropTable('OutreachActivities');
    await queryInterface.dropTable('LeadNotes');
    await queryInterface.dropTable('SavedLeads');
    await queryInterface.dropTable('Leads');
    await queryInterface.dropTable('Users');

    const dropEnum = (name) => queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${name}";`);
    await dropEnum('enum_Users_salespersonType');
    await dropEnum('enum_Users_role');
    await dropEnum('enum_SavedLeads_status');
    await dropEnum('enum_SavedLeads_priority');
    await dropEnum('enum_OutreachActivities_type');
    await dropEnum('enum_SubscriptionPlans_name');
    await dropEnum('enum_UserSubscriptions_status');
  },
};

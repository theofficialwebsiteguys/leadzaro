'use strict';

/**
 * Sales workflow (ADR 0011): one opportunity record carries the whole
 * lead → paid client path.
 *
 * - Opportunities get the new stage keys (the original value is kept in
 *   legacyStage), next action, last interaction, do-not-contact, deal
 *   value, stable sale attribution and a test-data flag.
 * - Prospect Organizations get agency-owned business details (phone,
 *   email, website, address) with a per-field source, so editing never
 *   touches the shared Google Places Lead row.
 * - OutreachActivities become conversations: channel, direction, origin
 *   (platform / manual / external), outcome, delivery status.
 * - Stripe: customer links per business and mode, richer payment
 *   requests (Payment Links and customer-bound Checkout Sessions),
 *   payments (Stripe-confirmed and authorized manual), subscriptions.
 * - Templates, handoffs and goals.
 */
const LEGACY_STAGES = {
  Discovered: 'new',
  'New Lead': 'new',
  Researching: 'new',
  'Attempting Contact': 'contacting',
  Contacted: 'contacting',
  Engaged: 'qualified',
  Qualified: 'qualified',
  'Proposal or Offer Prepared': 'proposal',
  'Payment Link Sent': 'awaiting_payment',
  'Closed Won': 'won',
  'Closed Lost': 'lost',
  Nurture: 'nurture',
  'Do Not Contact': 'lost',
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, INTEGER, BOOLEAN, DATE, TEXT, JSONB, UUID, UUIDV4 } = Sequelize;
    const col = (type, extra = {}) => ({ type, allowNull: true, ...extra });
    const userRef = { references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' };
    const timestamps = { createdAt: { type: DATE, allowNull: false }, updatedAt: { type: DATE, allowNull: false } };

    await queryInterface.sequelize.transaction(async (transaction) => {
      const add = (table, name, def) => queryInterface.addColumn(table, name, def, { transaction });
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      // Business details owned by the agency.
      for (const [name, def] of Object.entries({
        phone: col(STRING(50)), email: col(STRING(255)), website: col(STRING(500)), addressLine1: col(STRING(255)),
        city: col(STRING(100)), state: col(STRING(100)), postalCode: col(STRING(20)), category: col(STRING(150)),
        detailsSource: { type: JSONB, allowNull: false, defaultValue: {} },
      })) await add('Organizations', name, def);

      for (const [name, def] of Object.entries({
        title: col(STRING(200)),
        valueCents: col(INTEGER),
        currency: col(STRING(3)),
        nextActionAt: col(DATE),
        nextActionType: col(STRING(30)),
        nextActionNote: col(STRING(500)),
        lastInteractionAt: col(DATE),
        lastInteractionSummary: col(STRING(255)),
        replyNeededSince: col(DATE),
        doNotContact: { type: BOOLEAN, allowNull: false, defaultValue: false },
        doNotContactAt: col(DATE),
        doNotContactReason: col(STRING(255)),
        lostReason: col(STRING(255)),
        legacyStage: col(STRING(40)),
        stageChangedAt: col(DATE),
        wonAt: col(DATE),
        creditedUserId: col(UUID, userRef),
        createdByUserId: col(UUID, userRef),
        primaryContactId: col(UUID),
        isTest: { type: BOOLEAN, allowNull: false, defaultValue: false },
      })) await add('Opportunities', name, def);

      await queryInterface.changeColumn('OutreachActivities', 'leadId', { type: UUID, allowNull: true }, { transaction });
      for (const [name, def] of Object.entries({
        opportunityId: col(UUID, { references: { model: 'Opportunities', key: 'id' }, onDelete: 'SET NULL' }),
        contactId: col(UUID),
        channel: col(STRING(20)),
        direction: { type: STRING(10), allowNull: false, defaultValue: 'outbound' },
        origin: { type: STRING(10), allowNull: false, defaultValue: 'manual' },
        outcome: col(STRING(30)),
        status: col(STRING(20)),
        subject: col(STRING(300)),
        body: col(TEXT),
        toAddress: col(STRING(255)),
        fromAddress: col(STRING(255)),
        provider: col(STRING(30)),
        providerMessageId: col(STRING(100)),
        errorMessage: col(STRING(500)),
        idempotencyKey: col(STRING(100), { unique: true }),
        templateId: col(UUID),
        durationSeconds: col(INTEGER),
        completedFollowUp: { type: BOOLEAN, allowNull: false, defaultValue: false },
        occurredAt: col(DATE),
      })) await add('OutreachActivities', name, def);

      await queryInterface.changeColumn('LeadNotes', 'leadId', { type: UUID, allowNull: true }, { transaction });
      await add('LeadNotes', 'opportunityId', col(UUID, { references: { model: 'Opportunities', key: 'id' }, onDelete: 'SET NULL' }));

      await add('Contacts', 'doNotContact', { type: BOOLEAN, allowNull: false, defaultValue: false });
      await add('Contacts', 'verifiedAt', col(DATE));
      await add('Users', 'phone', col(STRING(50)));

      await queryInterface.changeColumn('PaymentLinkRequests', 'servicePlanId', { type: UUID, allowNull: true }, { transaction });
      for (const [name, def] of Object.entries({
        kind: { type: STRING(20), allowNull: false, defaultValue: 'payment_link' },
        stripeMode: col(STRING(10)),
        stripeAccountId: col(STRING(100)),
        stripeCheckoutSessionId: col(STRING(255)),
        stripeCustomerId: col(STRING(255)),
        organizationId: col(UUID),
        currency: col(STRING(3)),
        initialAmountCents: col(INTEGER),
        recurringAmountCents: col(INTEGER),
        recurringInterval: col(STRING(10)),
        lineItems: { type: JSONB, allowNull: false, defaultValue: [] },
        offerTitle: col(STRING(200)),
        expiresAt: col(DATE),
        idempotencyKey: col(STRING(100), { unique: true }),
        attributedUserId: col(UUID, userRef),
        sentAt: col(DATE),
        sentVia: col(STRING(20)),
        sentByUserId: col(UUID, userRef),
        paidAt: col(DATE),
        amountPaidCents: col(INTEGER),
        stripeSubscriptionId: col(STRING(255)),
        stripeInvoiceId: col(STRING(255)),
        stripePaymentIntentId: col(STRING(255)),
        deactivatedAt: col(DATE),
        deactivatedByUserId: col(UUID, userRef),
        lastError: col(STRING(500)),
        replacedByRequestId: col(UUID),
      })) await add('PaymentLinkRequests', name, def);

      await queryInterface.changeColumn('Subscriptions', 'servicePlanId', { type: UUID, allowNull: true }, { transaction });
      for (const [name, def] of Object.entries({
        stripeCustomerId: col(STRING(255)),
        stripeMode: col(STRING(10)),
        amountCents: col(INTEGER),
        currency: col(STRING(3)),
        interval: col(STRING(10)),
        productName: col(STRING(255)),
        cancelAtPeriodEnd: { type: BOOLEAN, allowNull: false, defaultValue: false },
        canceledAt: col(DATE),
        stripeUpdatedAt: col(DATE),
      })) await add('Subscriptions', name, def);

      await add('WebhookEvents', 'livemode', col(BOOLEAN));
      await add('WebhookEvents', 'stripeCreatedAt', col(DATE));

      await queryInterface.createTable('MessageTemplates', {
        id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        ownerUserId: col(UUID, { references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' }),
        scope: { type: STRING(10), allowNull: false },
        category: { type: STRING(30), allowNull: false },
        channel: { type: STRING(10), allowNull: false },
        name: { type: STRING(150), allowNull: false },
        subject: col(STRING(300)),
        body: { type: TEXT, allowNull: false },
        isDefault: { type: BOOLEAN, allowNull: false, defaultValue: false },
        archivedAt: col(DATE),
        createdByUserId: col(UUID, userRef),
        updatedByUserId: col(UUID, userRef),
        ...timestamps,
      }, { transaction });
      await queryInterface.addIndex('MessageTemplates', ['agencyOrganizationId', 'scope', 'ownerUserId'], { transaction });

      await queryInterface.createTable('StripeCustomerLinks', {
        id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        organizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        stripeCustomerId: { type: STRING(255), allowNull: false },
        stripeMode: { type: STRING(10), allowNull: false },
        stripeAccountId: col(STRING(100)),
        email: col(STRING(255)),
        name: col(STRING(255)),
        linkMethod: { type: STRING(20), allowNull: false },
        linkedByUserId: col(UUID, userRef),
        archivedAt: col(DATE),
        ...timestamps,
      }, { transaction });
      await queryInterface.addIndex('StripeCustomerLinks', ['agencyOrganizationId', 'organizationId', 'stripeMode'], {
        unique: true, where: { archivedAt: null }, name: 'stripe_customer_links_business_mode_unique', transaction,
      });
      await queryInterface.addIndex('StripeCustomerLinks', ['agencyOrganizationId', 'stripeCustomerId'], {
        unique: true, where: { archivedAt: null }, name: 'stripe_customer_links_customer_unique', transaction,
      });

      await queryInterface.createTable('SalesPayments', {
        id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        organizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        opportunityId: col(UUID, { references: { model: 'Opportunities', key: 'id' }, onDelete: 'SET NULL' }),
        paymentLinkRequestId: col(UUID, { references: { model: 'PaymentLinkRequests', key: 'id' }, onDelete: 'SET NULL' }),
        source: { type: STRING(10), allowNull: false },
        kind: { type: STRING(10), allowNull: false },
        status: { type: STRING(20), allowNull: false, defaultValue: 'succeeded' },
        amountCents: { type: INTEGER, allowNull: false },
        amountRefundedCents: { type: INTEGER, allowNull: false, defaultValue: 0 },
        currency: { type: STRING(3), allowNull: false },
        paidAt: { type: DATE, allowNull: false },
        stripeMode: col(STRING(10)),
        stripeCustomerId: col(STRING(255)),
        stripeCheckoutSessionId: col(STRING(255)),
        stripePaymentIntentId: col(STRING(255)),
        stripeInvoiceId: col(STRING(255)),
        stripeSubscriptionId: col(STRING(255)),
        stripeChargeId: col(STRING(255)),
        receiptUrl: col(STRING(500)),
        invoiceUrl: col(STRING(500)),
        attributedUserId: col(UUID, userRef),
        recordedByUserId: col(UUID, userRef),
        method: col(STRING(30)),
        reference: col(STRING(200)),
        note: col(TEXT),
        ...timestamps,
      }, { transaction });
      for (const field of ['stripeInvoiceId', 'stripePaymentIntentId', 'stripeCheckoutSessionId']) {
        await queryInterface.addIndex('SalesPayments', [field], {
          unique: true, where: { [field]: { [Sequelize.Op.ne]: null } }, name: `sales_payments_${field}_unique`, transaction,
        });
      }
      await queryInterface.addIndex('SalesPayments', ['agencyOrganizationId', 'paidAt'], { transaction });

      await queryInterface.createTable('SalesHandoffs', {
        id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        opportunityId: { type: UUID, allowNull: false, unique: true, references: { model: 'Opportunities', key: 'id' }, onDelete: 'CASCADE' },
        clientOrganizationId: col(UUID, { references: { model: 'Organizations', key: 'id' }, onDelete: 'SET NULL' }),
        projectId: col(UUID),
        status: { type: STRING(20), allowNull: false, defaultValue: 'pending' },
        data: { type: JSONB, allowNull: false, defaultValue: {} },
        items: { type: JSONB, allowNull: false, defaultValue: [] },
        lastError: col(TEXT),
        attempts: { type: INTEGER, allowNull: false, defaultValue: 0 },
        summaryNoteId: col(UUID),
        startedAt: col(DATE),
        completedAt: col(DATE),
        completedByUserId: col(UUID, userRef),
        ...timestamps,
      }, { transaction });

      await queryInterface.createTable('SalesGoals', {
        id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
        agencyOrganizationId: { type: UUID, allowNull: false, references: { model: 'Organizations', key: 'id' }, onDelete: 'CASCADE' },
        userId: col(UUID, { references: { model: 'Users', key: 'id' }, onDelete: 'CASCADE' }),
        metric: { type: STRING(30), allowNull: false },
        period: { type: STRING(10), allowNull: false, defaultValue: 'week' },
        target: { type: INTEGER, allowNull: false },
        updatedByUserId: col(UUID, userRef),
        ...timestamps,
      }, { transaction });
      await queryInterface.addIndex('SalesGoals', ['agencyOrganizationId', 'userId'], { transaction });

      await queryInterface.addIndex('Opportunities', ['agencyOrganizationId', 'assignedToUserId', 'nextActionAt'], { transaction });
      await queryInterface.addIndex('OutreachActivities', ['organizationId', 'opportunityId', 'createdAt'], { transaction });
      await queryInterface.addIndex('OutreachActivities', ['providerMessageId'], { transaction });

      // ---- Data: map stages, keep the original value, carry business details.
      const cases = Object.entries(LEGACY_STAGES).map(([from, to]) => `WHEN '${from.replace(/'/g, "''")}' THEN '${to}'`).join(' ');
      await q(`UPDATE "Opportunities"
        SET "legacyStage" = stage,
            "doNotContact" = (stage = 'Do Not Contact'),
            "doNotContactAt" = CASE WHEN stage = 'Do Not Contact' THEN "updatedAt" END,
            "doNotContactReason" = CASE WHEN stage = 'Do Not Contact' THEN 'Carried over from the old "Do Not Contact" stage' END,
            "lostReason" = CASE WHEN stage = 'Do Not Contact' THEN 'Do not contact' END,
            "stageChangedAt" = "updatedAt",
            "wonAt" = CASE WHEN stage = 'Closed Won' THEN "updatedAt" END,
            "creditedUserId" = CASE WHEN stage = 'Closed Won' THEN "assignedToUserId" END,
            stage = CASE stage ${cases} ELSE stage END
        WHERE stage IN (:stages)`, { stages: Object.keys(LEGACY_STAGES) });

      await q(`UPDATE "Opportunities" o SET "isTest" = true FROM "Leads" l WHERE l.id = o."sourceLeadId" AND l.source = 'demo'`);

      await q(`UPDATE "Organizations" org SET
          phone = l.phone, website = l.website, "addressLine1" = l.address, city = l.city, state = l.state,
          "postalCode" = l.zip, category = l.category,
          "detailsSource" = jsonb_strip_nulls(jsonb_build_object(
            'phone', CASE WHEN l.phone IS NOT NULL THEN src.s END,
            'website', CASE WHEN l.website IS NOT NULL THEN src.s END,
            'address', CASE WHEN l.address IS NOT NULL THEN src.s END))
        FROM "Opportunities" o
        JOIN "Leads" l ON l.id = o."sourceLeadId"
        CROSS JOIN LATERAL (SELECT CASE WHEN l.source IN ('google', 'google_places') THEN 'google_places' ELSE COALESCE(l.source, 'manual') END AS s) src
        WHERE o."organizationId" = org.id AND org.phone IS NULL AND org.website IS NULL`);

      // Conversations and notes: attach history to the opportunity it belongs to.
      await q(`UPDATE "OutreachActivities" oa SET "opportunityId" = pick.id
        FROM (
          SELECT DISTINCT ON (o."agencyOrganizationId", o."sourceLeadId") o.id, o."agencyOrganizationId", o."sourceLeadId"
          FROM "Opportunities" o WHERE o."deletedAt" IS NULL AND o."sourceLeadId" IS NOT NULL
          ORDER BY o."agencyOrganizationId", o."sourceLeadId", (o."archivedAt" IS NULL) DESC, o."createdAt" DESC
        ) pick
        WHERE pick."agencyOrganizationId" = oa."organizationId" AND pick."sourceLeadId" = oa."leadId" AND oa."opportunityId" IS NULL`);
      await q(`UPDATE "OutreachActivities" SET
          channel = CASE type::text WHEN 'email' THEN 'email' WHEN 'call' THEN 'call' WHEN 'visit' THEN 'in_person' WHEN 'message' THEN 'message' WHEN 'linkedin' THEN 'linkedin' ELSE 'other' END,
          "occurredAt" = "createdAt"
        WHERE channel IS NULL`);
      await q(`UPDATE "LeadNotes" n SET "opportunityId" = pick.id
        FROM (
          SELECT DISTINCT ON (o."agencyOrganizationId", o."sourceLeadId") o.id, o."agencyOrganizationId", o."sourceLeadId"
          FROM "Opportunities" o WHERE o."deletedAt" IS NULL AND o."sourceLeadId" IS NOT NULL
          ORDER BY o."agencyOrganizationId", o."sourceLeadId", (o."archivedAt" IS NULL) DESC, o."createdAt" DESC
        ) pick
        WHERE pick."agencyOrganizationId" = n."organizationId" AND pick."sourceLeadId" = n."leadId" AND n."opportunityId" IS NULL`);

      // Last interaction from the existing history.
      await q(`UPDATE "Opportunities" o SET "lastInteractionAt" = last.at
        FROM (SELECT "opportunityId", MAX("createdAt") AS at FROM "OutreachActivities" WHERE "opportunityId" IS NOT NULL AND "deletedAt" IS NULL GROUP BY "opportunityId") last
        WHERE last."opportunityId" = o.id`);

      // Follow-up dates set on the old Saved Leads screen become the next action.
      await q(`UPDATE "Opportunities" o SET "nextActionAt" = sl."nextFollowUpAt", "nextActionType" = 'follow_up'
        FROM "SavedLeads" sl
        WHERE sl."organizationId" = o."agencyOrganizationId" AND sl."leadId" = o."sourceLeadId"
          AND sl."nextFollowUpAt" IS NOT NULL AND sl."archivedAt" IS NULL AND sl."deletedAt" IS NULL
          AND o."nextActionAt" IS NULL AND o.stage NOT IN ('won', 'lost')`);

      await q(`UPDATE "PaymentLinkRequests" SET "stripeMode" = 'mock' WHERE "stripeMode" IS NULL AND "stripePaymentLinkId" LIKE 'mock_%'`);
      await q(`UPDATE "PaymentLinkRequests" p SET "organizationId" = o."organizationId", "attributedUserId" = p."createdByUserId"
        FROM "Opportunities" o WHERE o.id = p."opportunityId" AND p."organizationId" IS NULL`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const q = (sql) => queryInterface.sequelize.query(sql, { transaction });
      const drop = (table, name) => queryInterface.removeColumn(table, name, { transaction });

      await q(`UPDATE "Opportunities" SET stage = "legacyStage" WHERE "legacyStage" IS NOT NULL`);
      await q(`UPDATE "Opportunities" SET stage = CASE stage WHEN 'new' THEN 'New Lead' WHEN 'contacting' THEN 'Contacted' WHEN 'qualified' THEN 'Qualified'
        WHEN 'proposal' THEN 'Proposal or Offer Prepared' WHEN 'awaiting_payment' THEN 'Payment Link Sent' WHEN 'won' THEN 'Closed Won'
        WHEN 'lost' THEN 'Closed Lost' WHEN 'nurture' THEN 'Nurture' ELSE stage END WHERE "legacyStage" IS NULL`);

      for (const table of ['SalesGoals', 'SalesHandoffs', 'SalesPayments', 'StripeCustomerLinks', 'MessageTemplates']) {
        await queryInterface.dropTable(table, { transaction });
      }
      for (const name of ['livemode', 'stripeCreatedAt']) await drop('WebhookEvents', name);
      for (const name of ['stripeCustomerId', 'stripeMode', 'amountCents', 'currency', 'interval', 'productName', 'cancelAtPeriodEnd', 'canceledAt', 'stripeUpdatedAt']) await drop('Subscriptions', name);
      for (const name of ['kind', 'stripeMode', 'stripeAccountId', 'stripeCheckoutSessionId', 'stripeCustomerId', 'organizationId', 'currency', 'initialAmountCents',
        'recurringAmountCents', 'recurringInterval', 'lineItems', 'offerTitle', 'expiresAt', 'idempotencyKey', 'attributedUserId', 'sentAt', 'sentVia',
        'sentByUserId', 'paidAt', 'amountPaidCents', 'stripeSubscriptionId', 'stripeInvoiceId', 'stripePaymentIntentId', 'deactivatedAt',
        'deactivatedByUserId', 'lastError', 'replacedByRequestId']) await drop('PaymentLinkRequests', name);
      await drop('Users', 'phone');
      await drop('Contacts', 'doNotContact');
      await drop('Contacts', 'verifiedAt');
      await drop('LeadNotes', 'opportunityId');
      for (const name of ['opportunityId', 'contactId', 'channel', 'direction', 'origin', 'outcome', 'status', 'subject', 'body', 'toAddress', 'fromAddress',
        'provider', 'providerMessageId', 'errorMessage', 'idempotencyKey', 'templateId', 'durationSeconds', 'completedFollowUp', 'occurredAt']) await drop('OutreachActivities', name);
      for (const name of ['title', 'valueCents', 'currency', 'nextActionAt', 'nextActionType', 'nextActionNote', 'lastInteractionAt', 'lastInteractionSummary',
        'replyNeededSince', 'doNotContact', 'doNotContactAt', 'doNotContactReason', 'lostReason', 'legacyStage', 'stageChangedAt', 'wonAt',
        'creditedUserId', 'createdByUserId', 'primaryContactId', 'isTest']) await drop('Opportunities', name);
      for (const name of ['phone', 'email', 'website', 'addressLine1', 'city', 'state', 'postalCode', 'category', 'detailsSource']) await drop('Organizations', name);
    });
  },
};

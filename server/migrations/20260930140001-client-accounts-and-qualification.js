'use strict';

/**
 * Client accounts and deal qualification (ADR 0013).
 *
 * ClientProfiles gain what a client manager needs at 100+ accounts: the
 * account manager, services and agreed scope, who the account is waiting
 * on, the next client action, when they became a client (and ended), and
 * whether they came through sales or were an existing client. Every client
 * gets a profile row so these are always present; existing data is kept.
 *
 * Opportunities gain light qualification (need, service, decision-maker,
 * timing, budget) and a structured close reason.
 *
 * ConversionAttempts record whether a sale created a new client or sold to
 * an existing one, so upsells never inflate new-client counts.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT, DATE, DATEONLY, JSONB, UUID, BOOLEAN } = Sequelize;
    const col = (type, extra = {}) => ({ type, allowNull: true, ...extra });

    await queryInterface.sequelize.transaction(async (transaction) => {
      const add = (table, name, def) => queryInterface.addColumn(table, name, def, { transaction });
      const q = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      for (const [name, def] of Object.entries({
        accountManagerUserId: col(UUID, { references: { model: 'Users', key: 'id' }, onDelete: 'SET NULL' }),
        services: { type: JSONB, allowNull: false, defaultValue: [] },
        scopeNotes: col(TEXT),
        waitingOn: col(STRING(10)),
        waitingOnNote: col(STRING(255)),
        waitingOnSince: col(DATE),
        nextActionAt: col(DATE),
        nextActionNote: col(STRING(255)),
        clientSince: col(DATEONLY),
        clientEndedAt: col(DATEONLY),
        endReason: col(STRING(255)),
        acquisitionSource: col(STRING(20)),
      })) await add('ClientProfiles', name, def);

      for (const [name, def] of Object.entries({
        qualNeed: col(TEXT),
        qualService: col(STRING(200)),
        qualDecisionMaker: col(STRING(200)),
        qualTiming: col(STRING(200)),
        qualBudget: col(STRING(200)),
        closeReasonCode: col(STRING(30)),
      })) await add('Opportunities', name, def);

      await add('ConversionAttempts', 'createdNewClient', { type: BOOLEAN, allowNull: false, defaultValue: true });

      // Every client gets a profile row (they were created lazily before).
      await q(`INSERT INTO "ClientProfiles" (id, "organizationId", "agencyOrganizationId", "adminLinks", "billingLinks", services, "createdAt", "updatedAt")
        SELECT gen_random_uuid(), o.id, o."managingAgencyOrganizationId", '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, NOW(), NOW()
        FROM "Organizations" o
        WHERE o.type = 'client' AND o."managingAgencyOrganizationId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "ClientProfiles" p WHERE p."organizationId" = o.id)`);

      // Came through sales vs. already a client. The start date is only
      // known for sales; for existing clients it stays blank for a person
      // to fill in (the record's creation date is not when they started).
      await q(`UPDATE "ClientProfiles" p SET
          "acquisitionSource" = CASE WHEN first_sale.at IS NOT NULL THEN 'sales' ELSE 'existing' END,
          "clientSince" = first_sale.at::date
        FROM "Organizations" o
        LEFT JOIN LATERAL (
          SELECT MIN(ca."createdAt") AS at FROM "ConversionAttempts" ca
          WHERE ca."resultingClientOrganizationId" = o.id AND ca.status = 'completed'
        ) first_sale ON true
        WHERE o.id = p."organizationId" AND p."acquisitionSource" IS NULL`);

      await q(`UPDATE "Opportunities" SET "closeReasonCode" = CASE
          WHEN "doNotContact" = true AND stage = 'lost' THEN 'do_not_contact'
          WHEN "lostReason" ILIKE 'not interested%' THEN 'not_interested'
          ELSE 'other' END
        WHERE stage = 'lost' AND "closeReasonCode" IS NULL`);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const drop = (table, name) => queryInterface.removeColumn(table, name, { transaction });
      await drop('ConversionAttempts', 'createdNewClient');
      for (const name of ['qualNeed', 'qualService', 'qualDecisionMaker', 'qualTiming', 'qualBudget', 'closeReasonCode']) await drop('Opportunities', name);
      for (const name of ['accountManagerUserId', 'services', 'scopeNotes', 'waitingOn', 'waitingOnNote', 'waitingOnSince', 'nextActionAt', 'nextActionNote',
        'clientSince', 'clientEndedAt', 'endReason', 'acquisitionSource']) await drop('ClientProfiles', name);
    });
  },
};

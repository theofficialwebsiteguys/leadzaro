'use strict';

const crypto = require('node:crypto');

const WEBSITE_GUYS_SLUG = 'the-website-guys';

/**
 * Adds organization scope to the tables that were previously user-owned
 * only (SavedLeads, LeadNotes, OutreachActivities, UserSubscriptions),
 * backfills every existing row to the Website Guys organization seeded by
 * the previous migration, and marks legacy Users as pre-verified (they
 * already had working accounts; only newly self-registered or invited
 * users go through real verification).
 *
 * Highest-risk step in this phase: two different sales reps could have
 * independently saved the same canonical Lead before organizations
 * existed. Once everyone backfills into one organization, that becomes a
 * real (organizationId, leadId) collision. Those duplicates are archived
 * (soft-deleted), never hard-deleted — the row, its status/notes history,
 * and its own LeadNote/OutreachActivity rows all remain intact and
 * restorable by an administrator — and an AuditLog entry records exactly
 * which SavedLead survived as canonical. Only after this dedup does the
 * migration add a partial unique index on (organizationId, leadId) WHERE
 * "deletedAt" IS NULL, so exactly one *active* saved lead can exist per
 * organization per business, without destroying history.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      const [orgRows] = await query(`SELECT id FROM "Organizations" WHERE slug = :slug LIMIT 1`, { slug: WEBSITE_GUYS_SLUG });
      const websiteGuysOrgId = orgRows[0]?.id;
      if (!websiteGuysOrgId) {
        throw new Error('Website Guys organization not found — the seed migration must run before this one.');
      }

      // ── Users: mark existing accounts pre-verified ────────────────────
      await queryInterface.addColumn('Users', 'emailVerifiedAt', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await query(`UPDATE "Users" SET "emailVerifiedAt" = :now WHERE "emailVerifiedAt" IS NULL`, { now });

      // ── SavedLeads: add columns, backfill, dedupe, constrain ──────────
      await queryInterface.addColumn('SavedLeads', 'organizationId', { type: Sequelize.UUID, allowNull: true }, { transaction });
      await queryInterface.addColumn('SavedLeads', 'archivedAt', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn('SavedLeads', 'deletedAt', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn('SavedLeads', 'deletedByUserId', { type: Sequelize.UUID, allowNull: true }, { transaction });
      await query(`UPDATE "SavedLeads" SET "organizationId" = :orgId WHERE "organizationId" IS NULL`, { orgId: websiteGuysOrgId });

      const [duplicateGroups] = await query(`
        SELECT "organizationId", "leadId", array_agg(id ORDER BY "createdAt" ASC) AS ids
        FROM "SavedLeads"
        WHERE "deletedAt" IS NULL
        GROUP BY "organizationId", "leadId"
        HAVING COUNT(*) > 1
      `);
      for (const group of duplicateGroups) {
        const [canonicalId, ...duplicateIds] = group.ids;
        for (const dupId of duplicateIds) {
          await query(
            `UPDATE "SavedLeads" SET "deletedAt" = :now, "archivedAt" = :now WHERE id = :dupId`,
            { now, dupId }
          );
          await queryInterface.bulkInsert('AuditLogs', [{
            id: crypto.randomUUID(),
            organizationId: group.organizationId,
            actorUserId: null,
            action: 'saved_lead.auto_merged_duplicate',
            targetType: 'SavedLead',
            targetId: dupId,
            metadata: JSON.stringify({ canonicalSavedLeadId: canonicalId, reason: 'organization-scope migration collision' }),
            ipAddress: null,
            requestId: null,
            createdAt: now,
          }], { transaction });
        }
      }

      await queryInterface.changeColumn('SavedLeads', 'organizationId', { type: Sequelize.UUID, allowNull: false }, { transaction });
      await queryInterface.addIndex('SavedLeads', ['organizationId', 'leadId'], {
        unique: true,
        where: { deletedAt: null },
        name: 'saved_leads_org_lead_active_unique',
        transaction,
      });
      await queryInterface.addIndex('SavedLeads', ['organizationId'], { transaction });

      // ── LeadNotes: organization scope only (no delete endpoint exists) ─
      await queryInterface.addColumn('LeadNotes', 'organizationId', { type: Sequelize.UUID, allowNull: true }, { transaction });
      await query(`UPDATE "LeadNotes" SET "organizationId" = :orgId WHERE "organizationId" IS NULL`, { orgId: websiteGuysOrgId });
      await queryInterface.changeColumn('LeadNotes', 'organizationId', { type: Sequelize.UUID, allowNull: false }, { transaction });
      await queryInterface.addIndex('LeadNotes', ['organizationId'], { transaction });

      // ── OutreachActivities: organization scope + soft delete ──────────
      await queryInterface.addColumn('OutreachActivities', 'organizationId', { type: Sequelize.UUID, allowNull: true }, { transaction });
      await queryInterface.addColumn('OutreachActivities', 'archivedAt', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn('OutreachActivities', 'deletedAt', { type: Sequelize.DATE, allowNull: true }, { transaction });
      await queryInterface.addColumn('OutreachActivities', 'deletedByUserId', { type: Sequelize.UUID, allowNull: true }, { transaction });
      await query(`UPDATE "OutreachActivities" SET "organizationId" = :orgId WHERE "organizationId" IS NULL`, { orgId: websiteGuysOrgId });
      await queryInterface.changeColumn('OutreachActivities', 'organizationId', { type: Sequelize.UUID, allowNull: false }, { transaction });
      await queryInterface.addIndex('OutreachActivities', ['organizationId'], { transaction });

      // ── UserSubscriptions: nullable, documented temporary association ─
      await queryInterface.addColumn('UserSubscriptions', 'organizationId', { type: Sequelize.UUID, allowNull: true }, { transaction });
      await query(`UPDATE "UserSubscriptions" SET "organizationId" = :orgId WHERE "organizationId" IS NULL`, { orgId: websiteGuysOrgId });
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('UserSubscriptions', 'organizationId');

    await queryInterface.removeIndex('OutreachActivities', ['organizationId']);
    await queryInterface.removeColumn('OutreachActivities', 'deletedByUserId');
    await queryInterface.removeColumn('OutreachActivities', 'deletedAt');
    await queryInterface.removeColumn('OutreachActivities', 'archivedAt');
    await queryInterface.removeColumn('OutreachActivities', 'organizationId');

    await queryInterface.removeIndex('LeadNotes', ['organizationId']);
    await queryInterface.removeColumn('LeadNotes', 'organizationId');

    await queryInterface.removeIndex('SavedLeads', 'saved_leads_org_lead_active_unique');
    await queryInterface.removeIndex('SavedLeads', ['organizationId']);
    await queryInterface.removeColumn('SavedLeads', 'deletedByUserId');
    await queryInterface.removeColumn('SavedLeads', 'deletedAt');
    await queryInterface.removeColumn('SavedLeads', 'archivedAt');
    await queryInterface.removeColumn('SavedLeads', 'organizationId');

    await queryInterface.removeColumn('Users', 'emailVerifiedAt');
  },
};

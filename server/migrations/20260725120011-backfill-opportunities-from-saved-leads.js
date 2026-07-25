'use strict';

const crypto = require('node:crypto');
const { LEGACY_STATUS_TO_STAGE } = require('../core/crm/pipelineCatalog');

/**
 * Backfills the new CRM data model (prospect Organization + Opportunity)
 * from the existing SavedLead compatibility records, per the Phase 2 plan
 * validated by the mandated architecture review (docs/leadzaro/
 * current-phase-plan.md).
 *
 * Grouped by (organizationId, leadId) — NOT iterated per SavedLead row.
 * Phase 1's archive/restore feature means one organization can already
 * hold both an archived and an active SavedLead for the same business
 * (verify: SavedLeads' own partial unique index only guarantees at most
 * one *active* row per pair, not at most one row total). A naive per-row
 * migration would manufacture two prospect Organizations for one real
 * prospect, directly violating this phase's "no duplicate prospect
 * records" gate. Exactly one Organization + one Opportunity is created
 * per (organizationId, leadId) group, regardless of how many SavedLead
 * rows (active + archived history) that group contains.
 *
 * SavedLead itself is left completely untouched — this is additive only,
 * per ADR 0005's compatibility strategy.
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();

    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      const [groups] = await query(`
        SELECT "organizationId", "leadId", array_agg(id) AS ids
        FROM "SavedLeads"
        GROUP BY "organizationId", "leadId"
      `);

      for (const group of groups) {
        const [rows] = await query(`
          SELECT id, status, "userId", "archivedAt", "deletedAt", "createdAt"
          FROM "SavedLeads"
          WHERE id IN (:ids)
          ORDER BY "createdAt" DESC
        `, { ids: group.ids });

        const activeRow = rows.find((r) => !r.archivedAt && !r.deletedAt);
        const representative = activeRow || rows[0];

        const [leadRows] = await query(`SELECT name FROM "Leads" WHERE id = :leadId`, { leadId: group.leadId });
        const leadName = leadRows[0]?.name || 'Unnamed Prospect';

        const orgId = crypto.randomUUID();
        // Organization.slug is globally unique; many businesses can share
        // similar names across the whole system, so a plain name-slug
        // would intermittently collide. Disambiguate with an id fragment.
        const slug = `prospect-${slugify(leadName)}-${orgId.slice(0, 8)}`;

        await queryInterface.bulkInsert('Organizations', [{
          id: orgId,
          name: leadName,
          slug,
          type: 'prospect',
          status: 'active',
          managingAgencyOrganizationId: group.organizationId,
          createdAt: now,
          updatedAt: now,
        }], { transaction });

        const stage = LEGACY_STATUS_TO_STAGE[representative.status] || 'New Lead';
        const archivedAt = activeRow ? null : (representative.archivedAt || representative.deletedAt || now);

        await queryInterface.bulkInsert('Opportunities', [{
          id: crypto.randomUUID(),
          organizationId: orgId,
          agencyOrganizationId: group.organizationId,
          sourceLeadId: group.leadId,
          stage,
          assignedToUserId: representative.userId,
          archivedAt,
          createdAt: now,
          updatedAt: now,
        }], { transaction });
      }
    });
  },

  async down(queryInterface) {
    // Backfilled data only — no schema to reverse (see the sibling
    // create-crm-tables migration's down() for that). Not deleting the
    // backfilled Organizations/Opportunities here on purpose: by the time
    // a rollback of *this* migration would run, other work may already
    // reference them, and this is additive backfill data, not a schema
    // change that needs undoing.
  },
};

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'prospect';
}

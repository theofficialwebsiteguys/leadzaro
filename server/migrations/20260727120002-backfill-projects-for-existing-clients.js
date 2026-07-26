'use strict';

const crypto = require('node:crypto');

/**
 * Phase 4's opening obligation (documented since Phase 3: see
 * docs/leadzaro/current-phase-plan.md § 2a and ADR entries in the Phase 3
 * completion report's "Legacy/architecture boundary" section): every
 * client Organization must get exactly one Project, including every
 * pre-existing one — both the Phase 1 demo client (no ConversionAttempt
 * at all) and every Phase 3 conversion (a completed ConversionAttempt).
 *
 * Critical correction from the independent review, verified directly
 * against migration `20260725120008-add-organization-managing-agency.js`:
 * `agencyOrganizationId` is sourced from `Organization.
 * managingAgencyOrganizationId` directly, never from `ConversionAttempt`
 * — the demo client has no ConversionAttempt row at all, and sourcing
 * tenancy from it would leave that one Project untenanted. Only
 * `ownerUserId`/`sourceConversionAttemptId` are conditionally populated
 * from a matching completed ConversionAttempt where one exists.
 *
 * Idempotent: skips any client Organization that already has a Project
 * (safe to re-run after a partial failure).
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) => queryInterface.sequelize.query(sql, { replacements, transaction });

      const [clientOrgs] = await query(
        `SELECT id, "managingAgencyOrganizationId" FROM "Organizations" WHERE type = 'client'`
      );

      for (const org of clientOrgs) {
        const [existing] = await query(
          `SELECT id FROM "Projects" WHERE "organizationId" = :orgId LIMIT 1`,
          { orgId: org.id }
        );
        if (existing.length) continue;

        if (!org.managingAgencyOrganizationId) {
          // Every type='client' Organization is expected to have this set
          // (see migration 20260725120008). Refusing to silently default
          // is deliberate: an untenanted Project would be a real data-
          // integrity gap worth surfacing loudly, not something to paper
          // over here.
          throw new Error(
            `Organization ${org.id} has type='client' but no managingAgencyOrganizationId; `
            + 'refusing to backfill an untenanted Project.'
          );
        }

        const [conversionAttempts] = await query(
          `SELECT id, "createdByUserId" FROM "ConversionAttempts"
           WHERE "resultingClientOrganizationId" = :orgId AND status = 'completed'
           ORDER BY "createdAt" ASC LIMIT 1`,
          { orgId: org.id }
        );
        const conversionAttempt = conversionAttempts[0] || null;

        await queryInterface.bulkInsert('Projects', [{
          id: crypto.randomUUID(),
          organizationId: org.id,
          agencyOrganizationId: org.managingAgencyOrganizationId,
          ownerUserId: conversionAttempt?.createdByUserId || null,
          stage: 'Client Onboarding',
          healthStatus: 'on_track',
          healthStatusIsManualOverride: false,
          launchedAt: null,
          cancellationRequestedAt: null,
          sourceConversionAttemptId: conversionAttempt?.id || null,
          createdAt: now,
          updatedAt: now,
        }], { transaction });
      }
    });
  },

  async down() {
    // Data backfill, not a reference-data seed: not reversed, matching
    // this repo's established precedent (migrations 4 and 12) — by the
    // time a rollback would run, later phases' tables may already
    // reference these Project rows, making a blind delete unsafe.
  },
};

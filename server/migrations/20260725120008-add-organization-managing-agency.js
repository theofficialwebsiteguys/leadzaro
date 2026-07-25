'use strict';

/**
 * Found during the mandated final Phase 1 review: impersonation's
 * candidate lookup and start-impersonation check only filtered on
 * `membershipType: 'client'`, with no concept of *which* agency a client
 * organization belongs to — any Administrator with `impersonation.use`
 * could impersonate a member of *any* client organization in the system,
 * not just ones their own agency manages. There was no field expressing
 * that relationship at all.
 *
 * Adds `Organizations.managingAgencyOrganizationId` (nullable,
 * self-referential) and backfills the seeded demo client organization to
 * be managed by the seeded Website Guys organization, so the existing
 * impersonation demo keeps working under the new ownership check.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Organizations', 'managingAgencyOrganizationId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'Organizations', key: 'id' },
    });

    const [agencyRows] = await queryInterface.sequelize.query(
      `SELECT id FROM "Organizations" WHERE slug = 'the-website-guys' LIMIT 1`
    );
    const agencyOrgId = agencyRows[0]?.id;
    if (agencyOrgId) {
      await queryInterface.sequelize.query(
        `UPDATE "Organizations" SET "managingAgencyOrganizationId" = :agencyOrgId WHERE slug = 'demo-client' AND "managingAgencyOrganizationId" IS NULL`,
        { replacements: { agencyOrgId } }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Organizations', 'managingAgencyOrganizationId');
  },
};

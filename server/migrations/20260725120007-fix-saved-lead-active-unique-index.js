'use strict';

/**
 * Corrects the (organizationId, leadId) partial unique index added in
 * migration 5. That index only excluded rows with deletedAt set — but
 * per the Phase 1 archive lifecycle (Active -> Archived -> Trash ->
 * admin permanent delete), a normal employee "archive" action only sets
 * archivedAt, not deletedAt (deletedAt is reserved for the admin-only
 * Trash tier). Under the original index, archiving a SavedLead would
 * NOT free up its business for being saved again, which is wrong — once
 * archived, that slot should be reusable. The index now excludes a row
 * from the uniqueness check when *either* archivedAt or deletedAt is set.
 * No user-facing archive action exists yet at the time this migration is
 * written, so there is no real data whose meaning this changes.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex('SavedLeads', 'saved_leads_org_lead_active_unique');
    await queryInterface.addIndex('SavedLeads', ['organizationId', 'leadId'], {
      unique: true,
      where: { archivedAt: null, deletedAt: null },
      name: 'saved_leads_org_lead_active_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('SavedLeads', 'saved_leads_org_lead_active_unique');
    await queryInterface.addIndex('SavedLeads', ['organizationId', 'leadId'], {
      unique: true,
      where: { deletedAt: null },
      name: 'saved_leads_org_lead_active_unique',
    });
  },
};

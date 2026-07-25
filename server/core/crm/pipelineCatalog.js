'use strict';

/**
 * Single source of truth for CRM pipeline stages (Phase 2), following the
 * same pattern as Phase 1's authorization catalog: a validated reference
 * list, not a DataTypes.ENUM, per the master architecture's explicit
 * guidance to avoid enum churn for workflow-configurable concepts. Stage
 * order here is display/default-progression order, not a hard state
 * machine — the architecture calls for soft gates, not enforced linear
 * transitions.
 */
const STAGES = [
  'Discovered',
  'New Lead',
  'Researching',
  'Attempting Contact',
  'Contacted',
  'Engaged',
  'Qualified',
  'Proposal or Offer Prepared',
  'Payment Link Sent',
  'Closed Won',
  'Closed Lost',
  'Nurture',
  'Do Not Contact',
];

const CLOSED_STAGES = new Set(['Closed Won', 'Closed Lost']);

/**
 * Maps a legacy SavedLead.status value to an initial Opportunity.stage
 * during the Phase 2 backfill. A documented, reasonable-but-lossy
 * mapping — legacy status was a single flat field with no equivalent to
 * the richer pipeline, so this is a one-time judgment call, not a
 * reversible transformation.
 */
const LEGACY_STATUS_TO_STAGE = {
  New: 'New Lead',
  Saved: 'New Lead',
  Contacted: 'Contacted',
  'Follow Up': 'Engaged',
  Interested: 'Qualified',
  'Not Interested': 'Closed Lost',
  Closed: 'Closed Won',
  Archived: 'Nurture',
};

module.exports = {
  STAGES, CLOSED_STAGES, LEGACY_STATUS_TO_STAGE,
};

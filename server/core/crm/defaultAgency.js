'use strict';

const { Organization } = require('../../models');

/**
 * Resolves "the" agency that receives public inbound submissions.
 * Multi-agency SaaS is explicitly out of initial scope (master
 * architecture § 3) — today there is exactly one real agency
 * organization, seeded first during Phase 1 setup. Rather than hard-
 * coding a name/id, this resolves it the same way the rest of the
 * codebase avoids hard-coding "The Website Guys": by convention (the
 * oldest active agency-type Organization), so a future multi-agency
 * public-SaaS mode has one clear seam to change instead of scattered
 * hard-coded references.
 */
async function getDefaultAgencyOrganization() {
  const org = await Organization.findOne({
    where: { type: 'agency', status: 'active' },
    order: [['createdAt', 'ASC']],
  });
  if (!org) {
    const err = new Error('No agency organization is configured to receive inbound leads');
    err.statusCode = 503;
    throw err;
  }
  return org;
}

module.exports = { getDefaultAgencyOrganization };

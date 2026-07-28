'use strict';

const { Organization } = require('../../models');
const {
  listSeoTaskCyclesForRequester, listWebsiteRedirectsForRequester, listWebsitePageSeoSettingsForRequester,
  getLatestWebsiteSeoAuditSummaryForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('../websites/websiteService');
const { hasSeoEntitlement } = require('./seoEntitlementService');

function forbidden(message) {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}

/**
 * The concrete answer to the roadmap's "entitlement-gated SEO
 * dashboard" outcome (current-phase-plan.md § 2e) — deliberately NOT
 * gated by assertSeoEntitlement itself (that would be circular: a
 * non-entitled organization could never see that it isn't entitled).
 * Reachable by both employees and clients (projects.view), using only
 * the client-safe summary accessor for audit data — an employee who
 * wants raw findings already has the dedicated, builder.manage-gated
 * /seo/audits/:auditId route from slice 5.
 */
async function getDashboard(context, projectId) {
  const website = await getWebsite(context, projectId);
  const entitled = await hasSeoEntitlement(website.organizationId);

  if (!entitled) {
    return {
      entitled: false, latestAudit: null, taskCycleCount: 0, redirectCount: 0, pageSettingsConfiguredCount: 0, googleSearchConsolePropertyUrl: null,
    };
  }

  // listSeoTaskCyclesForRequester/listWebsiteRedirectsForRequester are
  // employee-only and throw SYNCHRONOUSLY at call time (not as a
  // rejected promise) for a client context — a chained .catch() would
  // never attach, since the function call itself throws before
  // returning anything. Checked explicitly instead, so a client
  // caller gets a real, if narrower, dashboard rather than a 500.
  const isEmployee = context.membership.membershipType !== 'client';

  const [latestAudit, taskCycles, redirects, pageSettings] = await Promise.all([
    getLatestWebsiteSeoAuditSummaryForRequester(context, website.id),
    isEmployee ? listSeoTaskCyclesForRequester(context, { websiteId: website.id }) : Promise.resolve([]),
    isEmployee ? listWebsiteRedirectsForRequester(context, { websiteId: website.id }) : Promise.resolve([]),
    listWebsitePageSeoSettingsForRequester(context, { websiteId: website.id }),
  ]);

  return {
    entitled: true,
    latestAudit,
    taskCycleCount: taskCycles.length,
    redirectCount: redirects.length,
    pageSettingsConfiguredCount: pageSettings.length,
    googleSearchConsolePropertyUrl: website.googleSearchConsolePropertyUrl,
  };
}

/**
 * Owner executive reporting (current-phase-plan.md § 2e) — a real,
 * useful, deliberately scoped rollup: entitlement status per client
 * organization across the whole agency. Full per-website audit-health
 * rollup was judged disproportionate for this slice's own scope (each
 * client org can have its own website's dashboard for that detail);
 * this view answers the agency-wide question "who has SEO and who
 * doesn't." Employee-only — reuses seo.manage_entitlements (slice 1)
 * rather than introducing a new permission for one reporting view.
 */
async function getAgencySeoOverview(context) {
  if (context.membership.membershipType === 'client') {
    throw forbidden('Only agency employees can view the agency SEO overview');
  }

  const clientOrgs = await Organization.findAll({
    where: { managingAgencyOrganizationId: context.organization.id, type: 'client' },
    order: [['name', 'ASC']],
  });

  return Promise.all(clientOrgs.map(async (org) => ({
    organizationId: org.id,
    organizationName: org.name,
    entitled: await hasSeoEntitlement(org.id),
  })));
}

module.exports = { getDashboard, getAgencySeoOverview };

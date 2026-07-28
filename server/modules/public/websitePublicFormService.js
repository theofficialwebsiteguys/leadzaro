'use strict';

const { WebsitePublicFormSubmission } = require('../../models');
const {
  getLiveWebsiteForPublicSubmission, getLiveWebsiteVersionForPublicSubmission,
} = require('../../core/authorization/clientVisibleModels');

function notFound() {
  const err = new Error('Not found');
  err.statusCode = 404;
  return err;
}

/**
 * The first genuinely anonymous, unauthenticated write path in this
 * codebase (current-phase-plan.md § 2e). A real site visitor has no
 * membership/organization context at all, so this never goes through
 * getWebsite/websiteService the way an authenticated builder action
 * does — every lookup here is one of the two explicit, documented
 * no-requester exceptions in clientVisibleModels.js.
 *
 * review finding #10: an identical, generic 404 for "no such website,"
 * "website exists but isn't live in production yet," and "this page/
 * section doesn't exist or isn't a form" — never a distinguishable
 * response that would confirm a draft-only or not-yet-deployed
 * website's existence to an anonymous caller.
 */
async function submitWebsiteForm({
  websiteId, pageId, sectionId, values, honeypot,
}) {
  // Silently discard bot submissions (a filled honeypot field), same
  // response shape as a real submission — matches /inbound-leads'
  // established precedent (server/modules/public/inboundLeadService.js).
  if (honeypot) return { submitted: true };

  const website = await getLiveWebsiteForPublicSubmission(websiteId);
  if (!website) throw notFound();

  const version = await getLiveWebsiteVersionForPublicSubmission(website.currentLiveProductionDeploymentId);
  if (!version) throw notFound();

  const page = (version.schema?.pages || []).find((p) => p.id === pageId);
  const section = page?.sections?.find((s) => s.id === sectionId);
  if (!section || section.componentKey !== 'form') throw notFound();

  const submission = await WebsitePublicFormSubmission.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    websiteVersionId: version.id,
    pageId,
    sectionId,
    values: values || {},
    status: 'pending_review',
  });

  return { submitted: true, submissionId: submission.id };
}

module.exports = { submitWebsiteForm };

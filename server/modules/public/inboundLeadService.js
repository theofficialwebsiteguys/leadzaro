'use strict';

const crypto = require('node:crypto');
const {
  sequelize, Organization, Opportunity, Contact, InboundSubmission,
} = require('../../models');
const { getDefaultAgencyOrganization } = require('../../core/crm/defaultAgency');
const { getCampaign } = require('../../core/crm/inboundCampaigns');
const { slugify } = require('../../core/crm/slugify');
const { STAGES } = require('../../core/crm/pipelineCatalog');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Creates a prospect Organization + Opportunity + Contact from a public
 * marketing-page submission, with no canonical Lead involved (unlike
 * `opportunityService.createFromLead`, there is no Google Place behind
 * this — it's entirely self-reported). Always resolves to the single
 * default agency organization; multi-agency public acquisition is out
 * of scope (see `defaultAgency.js`).
 */
async function submitInboundLead({
  landingPageSlug, contactName, contactEmail, contactPhone, businessName, message,
  utmSource, utmMedium, utmCampaign, utmTerm, utmContent, referrer, honeypot,
}) {
  // Silently discard bot submissions (a filled honeypot field) without
  // creating any records, but report the same success shape so a bot
  // doesn't learn it was caught and try a different approach.
  if (honeypot) return { submitted: true };

  const campaign = getCampaign(landingPageSlug);
  if (!campaign) throw invalid('Unknown landing page');

  const agency = await getDefaultAgencyOrganization();

  const opportunityId = await sequelize.transaction(async (transaction) => {
    const orgId = crypto.randomUUID();
    const displayName = businessName || contactName;
    const prospectOrg = await Organization.create({
      id: orgId,
      name: displayName,
      slug: `prospect-${slugify(displayName)}-${orgId.slice(0, 8)}`,
      type: 'prospect',
      status: 'active',
      managingAgencyOrganizationId: agency.id,
    }, { transaction });

    const opportunity = await Opportunity.create({
      organizationId: prospectOrg.id,
      agencyOrganizationId: agency.id,
      sourceLeadId: null,
      stage: STAGES[0],
      assignedToUserId: null,
    }, { transaction });

    await Contact.create({
      organizationId: prospectOrg.id,
      agencyOrganizationId: agency.id,
      name: contactName,
      email: contactEmail || null,
      phone: contactPhone || null,
      source: 'inbound_form',
      isPrimary: true,
    }, { transaction });

    await InboundSubmission.create({
      opportunityId: opportunity.id,
      agencyOrganizationId: agency.id,
      landingPageSlug: campaign.slug,
      requestedService: campaign.requestedService,
      message: message || null,
      utmSource: utmSource || null,
      utmMedium: utmMedium || null,
      utmCampaign: utmCampaign || null,
      utmTerm: utmTerm || null,
      utmContent: utmContent || null,
      referrer: referrer || null,
    }, { transaction });

    return opportunity.id;
  });

  return { submitted: true, opportunityId, agencyOrganizationId: agency.id };
}

module.exports = { submitInboundLead };

'use strict';

const {
  Enrichment, Opportunity, Organization, Lead,
} = require('../../models');
const { getEnrichmentAdapter } = require('../../core/integrations/enrichment/enrichmentAdapter');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function getOpportunityInAgency(opportunityId, agencyOrganizationId) {
  const opportunity = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId, deletedAt: null },
    include: [{ model: Organization, as: 'organization' }, { model: Lead, as: 'sourceLead' }],
  });
  if (!opportunity) throw invalid('Opportunity not found', 404);
  return opportunity;
}

/** Requests (or refreshes, in place) enrichment for an opportunity. Never
 * throws for a "not configured"/"no data" outcome — that's a normal,
 * structured result the caller/UI must show plainly, not an error. */
async function enrichOpportunity(opportunityId, agencyOrganizationId, actorUserId) {
  const opportunity = await getOpportunityInAgency(opportunityId, agencyOrganizationId);
  const adapter = getEnrichmentAdapter();

  const result = await adapter.enrich({
    businessName: opportunity.organization?.name,
    website: opportunity.sourceLead?.website,
    phone: opportunity.sourceLead?.phone,
    category: opportunity.sourceLead?.category,
  });

  const requestedAt = new Date();
  const existing = await Enrichment.findOne({ where: { opportunityId } });
  if (existing) {
    await existing.update({
      provider: result.provider, status: result.status, data: result.data, requestedByUserId: actorUserId, requestedAt,
    });
    return existing;
  }

  return Enrichment.create({
    opportunityId,
    agencyOrganizationId,
    provider: result.provider,
    status: result.status,
    data: result.data,
    requestedByUserId: actorUserId,
    requestedAt,
  });
}

async function getForOpportunity(opportunityId, agencyOrganizationId) {
  await getOpportunityInAgency(opportunityId, agencyOrganizationId);
  const enrichment = await Enrichment.findOne({ where: { opportunityId } });
  if (!enrichment) throw invalid('No enrichment has been requested for this opportunity yet', 404);
  return enrichment;
}

module.exports = { enrichOpportunity, getForOpportunity };

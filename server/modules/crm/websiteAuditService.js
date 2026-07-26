'use strict';

const {
  WebsiteAudit, Opportunity, Lead,
} = require('../../models');
const { generateRawToken, hashToken } = require('../../core/security/tokens');
const { runRuleBasedAudit } = require('../../core/crm/websiteAuditor');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function getOpportunityInAgency(opportunityId, agencyOrganizationId) {
  const opportunity = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId, deletedAt: null },
    include: [{ model: Lead, as: 'sourceLead' }],
  });
  if (!opportunity) throw invalid('Opportunity not found', 404);
  return opportunity;
}

/**
 * Creates the audit if none exists yet, or refreshes an existing one in
 * place — the share token is only generated once and kept stable across
 * refreshes, so a link already handed to a prospect keeps working and
 * simply shows the latest report rather than breaking.
 */
async function generateAudit(opportunityId, agencyOrganizationId, actorUserId) {
  const opportunity = await getOpportunityInAgency(opportunityId, agencyOrganizationId);
  const lead = opportunity.sourceLead;

  const { score, summary, checks } = runRuleBasedAudit({
    hasWebsite: lead?.hasWebsite,
    website: lead?.website,
    rating: lead?.rating,
    reviewCount: lead?.reviewCount,
    category: lead?.category,
  });

  const existing = await WebsiteAudit.findOne({ where: { opportunityId } });
  const generatedAt = new Date();

  if (existing) {
    await existing.update({
      score, summary, checks, generatedByUserId: actorUserId, generatedAt,
    });
    return { audit: existing, rawToken: null };
  }

  const rawToken = generateRawToken();
  const audit = await WebsiteAudit.create({
    opportunityId,
    agencyOrganizationId,
    score,
    summary,
    checks,
    shareTokenHash: hashToken(rawToken),
    generatedByUserId: actorUserId,
    generatedAt,
  });
  return { audit, rawToken };
}

/**
 * The share token is hashed at rest, so the server can never redisplay
 * a previously-issued raw token — if it's lost, the only way to get a
 * working link again is to mint a new one, invalidating the old one.
 * Mirrors invitationService.resendInvitation's token rotation.
 */
async function rotateShareLink(opportunityId, agencyOrganizationId) {
  const audit = await getForOpportunity(opportunityId, agencyOrganizationId);
  const rawToken = generateRawToken();
  await audit.update({ shareTokenHash: hashToken(rawToken) });
  return { audit, rawToken };
}

async function getForOpportunity(opportunityId, agencyOrganizationId) {
  await getOpportunityInAgency(opportunityId, agencyOrganizationId);
  const audit = await WebsiteAudit.findOne({ where: { opportunityId } });
  if (!audit) throw invalid('No audit has been generated for this opportunity yet', 404);
  return audit;
}

/**
 * Public, unauthenticated lookup by share token — returns only what a
 * prospect should see (business name, website, report), never internal
 * CRM identifiers (opportunityId, agencyOrganizationId, assignee, etc.).
 */
async function getPublicByToken(rawToken) {
  const audit = await WebsiteAudit.findOne({
    where: { shareTokenHash: hashToken(rawToken) },
    include: [{ model: Opportunity, as: 'opportunity', include: [{ model: Lead, as: 'sourceLead' }] }],
  });
  if (!audit) throw invalid('This report link is invalid', 404);

  const lead = audit.opportunity?.sourceLead;
  return {
    businessName: lead?.name || 'This business',
    website: lead?.website || null,
    score: audit.score,
    summary: audit.summary,
    checks: audit.checks,
    generatedAt: audit.generatedAt,
  };
}

module.exports = {
  generateAudit, getForOpportunity, getPublicByToken, rotateShareLink,
};

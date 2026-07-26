'use strict';

const enrichmentService = require('./enrichmentService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function enrich(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const enrichment = await enrichmentService.enrichOpportunity(req.params.id, orgId, req.user.id);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'opportunity.enriched', targetType: 'Opportunity', targetId: req.params.id, metadata: { provider: enrichment.provider, status: enrichment.status }, req,
    });

    return success(res, { enrichment }, 'Enrichment requested');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getForOpportunity(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const enrichment = await enrichmentService.getForOpportunity(req.params.id, orgId);
    return success(res, { enrichment });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { enrich, getForOpportunity };

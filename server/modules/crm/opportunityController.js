const opportunityService = require('./opportunityService');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const {
  success, created, error,
} = require('../../utils/response');
const { formatPaginatedResponse } = require('../../utils/pagination');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function create(req, res, next) {
  try {
    const agencyOrganizationId = req.context.organization.id;
    const { leadData, assignedToUserId } = req.body;
    const { opportunity, organization, lead } = await opportunityService.createFromLead({
      agencyOrganizationId, leadData, assignedToUserId, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: agencyOrganizationId,
      actorUserId: req.user.id,
      action: 'opportunity.created',
      targetType: 'Opportunity',
      targetId: opportunity.id,
      metadata: { prospectOrganizationId: organization.id, leadId: lead.id },
      req,
    });

    return created(res, { opportunity, organization }, 'Opportunity created');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function list(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { rows, count } = await opportunityService.listForAgency(req.context.organization.id, {
      ...req.query, page, limit,
    });
    return success(res, formatPaginatedResponse(rows, count, Number(page), Number(limit)));
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const opportunity = await opportunityService.getInAgency(req.params.id, req.context.organization.id);
    return success(res, { opportunity });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function updateStage(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const opportunity = await opportunityService.updateStage(req.params.id, orgId, req.body);

    await recordAudit({
      organizationId: orgId,
      actorUserId: req.user.id,
      action: 'opportunity.stage_updated',
      targetType: 'Opportunity',
      targetId: opportunity.id,
      metadata: { stage: opportunity.stage, score: opportunity.score },
      req,
    });

    return success(res, { opportunity }, 'Opportunity updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function claim(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const opportunity = await opportunityService.claim(req.params.id, orgId, req.user.id);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'opportunity.claimed', targetType: 'Opportunity', targetId: opportunity.id, req,
    });

    return success(res, { opportunity }, 'Opportunity claimed');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function assign(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const opportunity = await opportunityService.assign(req.params.id, orgId, req.body.userId);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'opportunity.assigned', targetType: 'Opportunity', targetId: opportunity.id, metadata: { assignedToUserId: req.body.userId }, req,
    });
    await notify({
      userId: req.body.userId, organizationId: orgId, type: 'lead_assignment', title: 'A lead was assigned to you',
    });

    return success(res, { opportunity }, 'Opportunity assigned');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function roundRobinAssign(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const opportunity = await opportunityService.roundRobinAssign(req.params.id, orgId);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'opportunity.round_robin_assigned', targetType: 'Opportunity', targetId: opportunity.id, metadata: { assignedToUserId: opportunity.assignedToUserId }, req,
    });
    await notify({
      userId: opportunity.assignedToUserId, organizationId: orgId, type: 'lead_assignment', title: 'A lead was assigned to you',
    });

    return success(res, { opportunity }, 'Opportunity assigned via round robin');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function archive(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const opportunity = await opportunityService.archive(req.params.id, orgId);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'opportunity.archived', targetType: 'Opportunity', targetId: opportunity.id, req,
    });

    return success(res, { opportunity }, 'Opportunity archived');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function restore(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const opportunity = await opportunityService.restore(req.params.id, orgId);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'opportunity.restored', targetType: 'Opportunity', targetId: opportunity.id, req,
    });

    return success(res, { opportunity }, 'Opportunity restored');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  create, list, getById, updateStage, claim, assign, roundRobinAssign, archive, restore,
};

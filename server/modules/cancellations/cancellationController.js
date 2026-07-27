'use strict';

const cancellationService = require('./cancellationService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const cancellationRequests = await cancellationService.listCancellationRequests(req.context, req.params.projectId);
    return success(res, { cancellationRequests });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function create(req, res, next) {
  try {
    const cancellationRequest = await cancellationService.requestCancellation({
      context: req.context,
      projectId: req.params.projectId,
      reason: req.body.reason,
      requestedByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'cancellation.requested',
      targetType: 'CancellationRequest',
      targetId: cancellationRequest.id,
      metadata: { projectId: req.params.projectId, initiatedBy: cancellationRequest.initiatedBy },
      req,
    });

    return success(res, { cancellationRequest }, 'Cancellation requested', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function confirm(req, res, next) {
  try {
    const cancellationRequest = await cancellationService.confirmCancellation({
      context: req.context, requestId: req.params.requestId, confirmedByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'cancellation.confirmed',
      targetType: 'CancellationRequest',
      targetId: cancellationRequest.id,
      req,
    });

    return success(res, { cancellationRequest }, 'Cancellation confirmed');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function withdraw(req, res, next) {
  try {
    const cancellationRequest = await cancellationService.withdrawCancellation({
      context: req.context, requestId: req.params.requestId, withdrawnByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'cancellation.withdrawn',
      targetType: 'CancellationRequest',
      targetId: cancellationRequest.id,
      req,
    });

    return success(res, { cancellationRequest }, 'Cancellation withdrawn');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list, create, confirm, withdraw,
};

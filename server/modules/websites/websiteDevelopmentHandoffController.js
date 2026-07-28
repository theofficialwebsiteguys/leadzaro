'use strict';

const websiteDevelopmentHandoffService = require('./websiteDevelopmentHandoffService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function promote(req, res, next) {
  try {
    const result = await websiteDevelopmentHandoffService.promoteToDevelopment({
      context: req.context,
      projectId: req.params.projectId,
      versionId: req.params.versionId,
      technicalHandoffNotes: req.body.technicalHandoffNotes,
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.promoted_to_development',
      targetType: 'WebsiteDevelopmentHandoff',
      targetId: result.handoff.id,
      metadata: {
        versionId: req.params.versionId, deploymentId: result.deployment.id, taskId: result.task.id, notifiedUserIds: result.notifiedUserIds,
      },
      req,
    });

    return success(res, result, 'Promoted to development', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function list(req, res, next) {
  try {
    const handoffs = await websiteDevelopmentHandoffService.listHandoffs(req.context, req.params.projectId);
    return success(res, { handoffs });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { promote, list };

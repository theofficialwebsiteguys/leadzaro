'use strict';

const websiteDeploymentService = require('./websiteDeploymentService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function deployPreview(req, res, next) {
  try {
    const deployment = await websiteDeploymentService.deployPreview({
      context: req.context, projectId: req.params.projectId, versionId: req.params.versionId, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.preview_deployed',
      targetType: 'WebsiteDeployment',
      targetId: deployment.id,
      metadata: { versionId: req.params.versionId, status: deployment.status, previewUrl: deployment.previewUrl },
      req,
    });

    return success(res, { deployment }, 'Preview deployed', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listDeployments(req, res, next) {
  try {
    const deployments = await websiteDeploymentService.listDeployments(req.context, req.params.projectId);
    return success(res, { deployments });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { deployPreview, listDeployments };

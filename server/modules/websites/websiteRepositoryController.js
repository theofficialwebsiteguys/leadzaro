'use strict';

const websiteRepositoryService = require('./websiteRepositoryService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function get(req, res, next) {
  try {
    const repository = await websiteRepositoryService.getRepository(req.context, req.params.projectId);
    return success(res, { repository });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function provision(req, res, next) {
  try {
    const repository = await websiteRepositoryService.provisionRepository({
      context: req.context, projectId: req.params.projectId, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.repository_provisioned',
      targetType: 'WebsiteRepository',
      targetId: repository.id,
      metadata: { projectId: req.params.projectId, status: repository.status },
      req,
    });

    return success(res, { repository }, 'Repository provisioned');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { get, provision };

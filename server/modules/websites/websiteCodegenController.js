'use strict';

const websiteCodegenService = require('./websiteCodegenService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function generate(req, res, next) {
  try {
    const result = await websiteCodegenService.generateAndCommit({
      context: req.context, projectId: req.params.projectId, versionId: req.params.versionId,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.generated',
      targetType: 'WebsiteVersion',
      targetId: req.params.versionId,
      metadata: { fileCount: result.fileCount, branch: result.branch },
      req,
    });

    return success(res, result, 'Generated and committed');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { generate };

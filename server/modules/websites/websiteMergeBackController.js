'use strict';

const websiteMergeBackService = require('./websiteMergeBackService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function mergeBack(req, res, next) {
  try {
    const result = await websiteMergeBackService.mergeBack({
      context: req.context, projectId: req.params.projectId, branchName: req.body.branchName, title: req.body.title,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.merged_back',
      targetType: 'Website',
      targetId: req.params.projectId,
      metadata: { branchName: result.branchName, baseBranch: result.baseBranch, pullRequestNumber: result.pullRequest.number },
      req,
    });

    return success(res, result, 'Merged back');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { mergeBack };

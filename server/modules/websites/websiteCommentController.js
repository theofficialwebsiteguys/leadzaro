'use strict';

const websiteCommentService = require('./websiteCommentService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const comments = await websiteCommentService.listComments(req.context, req.params.projectId);
    return success(res, { comments });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function create(req, res, next) {
  try {
    const comment = await websiteCommentService.createComment({
      context: req.context,
      projectId: req.params.projectId,
      versionId: req.body.versionId,
      anchorKey: req.body.anchorKey,
      body: req.body.body,
      isInternal: req.body.isInternal,
      authorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.comment_created',
      targetType: 'WebsiteComment',
      targetId: comment.id,
      metadata: { anchorKey: comment.anchorKey, isInternal: comment.isInternal },
      req,
    });

    return success(res, { comment }, 'Comment added', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function resolve(req, res, next) {
  try {
    const comment = await websiteCommentService.resolveComment({
      context: req.context, projectId: req.params.projectId, commentId: req.params.commentId,
    });
    return success(res, { comment }, 'Comment resolved');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { list, create, resolve };

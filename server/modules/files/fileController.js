'use strict';

const fileService = require('./fileService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const files = await fileService.listFiles(req.context, req.params.projectId);
    return success(res, { files });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function upload(req, res, next) {
  try {
    if (!req.file) return error(res, 'A file is required', 422);

    const file = await fileService.uploadFile({
      context: req.context,
      projectId: req.params.projectId,
      scope: req.body.scope,
      relatedId: req.body.relatedId,
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      isPrivate: req.body.isPrivate !== 'false',
      uploadedByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'file.uploaded', targetType: 'File', targetId: file.id, metadata: { scope: file.scope, originalName: file.originalName }, req,
    });

    return success(res, { file }, 'File uploaded', 201);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getSignedUrl(req, res, next) {
  try {
    const { file, url, expiresInSeconds } = await fileService.getSignedUrl(req.context, req.params.fileId, req.query.variant, { download: req.query.download === '1' });
    return success(res, {
      file, url, expiresInSeconds,
    });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function remove(req, res, next) {
  try {
    const result = await fileService.deleteFile(req.context, req.params.fileId);
    await recordAudit({
      organizationId: req.context.organization.id, actorUserId: req.user.id, action: 'file.deleted', targetType: 'File', targetId: req.params.fileId, req,
    });
    return success(res, result, 'File deleted');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list, upload, getSignedUrl, remove,
};

'use strict';

const websiteExportService = require('./websiteExportService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

async function exportWebsite(req, res, next) {
  try {
    const bundle = await websiteExportService.exportWebsite(req.context, req.params.projectId, req.params.versionId);

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.exported',
      targetType: 'WebsiteVersion',
      targetId: req.params.versionId,
      metadata: { projectId: req.params.projectId, fileCount: bundle.files.length },
      req,
    });

    return success(res, { export: bundle });
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = { exportWebsite };

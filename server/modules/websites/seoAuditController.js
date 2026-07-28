'use strict';

const seoAuditService = require('../seo/seoAuditService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function run(req, res, next) {
  try {
    const audit = await seoAuditService.runAudit({
      context: req.context, projectId: req.params.projectId, versionId: req.body.versionId, actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'seo.audit_run',
      targetType: 'WebsiteSeoAudit',
      targetId: audit.id,
      metadata: { projectId: req.params.projectId, findingCount: audit.findings.length },
      req,
    });

    return success(res, { audit }, `Audit complete: ${audit.findings.length} finding(s)`);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function list(req, res, next) {
  try {
    const audits = await seoAuditService.listAudits(req.context, req.params.projectId);
    return success(res, { audits });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function get(req, res, next) {
  try {
    const audit = await seoAuditService.getAudit(req.context, req.params.projectId, req.params.auditId);
    if (!audit) return error(res, 'Audit not found', 404);
    return success(res, { audit });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { run, list, get };

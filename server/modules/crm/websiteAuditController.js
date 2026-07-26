'use strict';

const websiteAuditService = require('./websiteAuditService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');
const { env } = require('../../core/config/env');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

function shareUrl(rawToken) {
  return `${env.APP_BASE_URL}/audit/${rawToken}`;
}

async function generate(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const { audit, rawToken } = await websiteAuditService.generateAudit(req.params.id, orgId, req.user.id);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'website_audit.generated', targetType: 'Opportunity', targetId: req.params.id, metadata: { score: audit.score }, req,
    });

    return success(res, {
      audit,
      // Only present the first time this audit is created — the share
      // link is stable, so later refreshes don't need to re-issue it.
      shareUrl: rawToken ? shareUrl(rawToken) : undefined,
    }, 'Website audit generated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function rotateLink(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const { audit, rawToken } = await websiteAuditService.rotateShareLink(req.params.id, orgId);

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'website_audit.link_rotated', targetType: 'Opportunity', targetId: req.params.id, req,
    });

    return success(res, { audit, shareUrl: shareUrl(rawToken) }, 'Share link reset — the old link no longer works');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getForOpportunity(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const audit = await websiteAuditService.getForOpportunity(req.params.id, orgId);
    return success(res, { audit });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getPublic(req, res, next) {
  try {
    const report = await websiteAuditService.getPublicByToken(req.params.token);
    return success(res, report);
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  generate, rotateLink, getForOpportunity, getPublic,
};

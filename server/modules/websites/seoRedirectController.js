'use strict';

const seoRedirectService = require('../seo/seoRedirectService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const redirects = await seoRedirectService.listRedirects(req.context, req.params.projectId);
    return success(res, { redirects });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function create(req, res, next) {
  try {
    const redirect = await seoRedirectService.createRedirect({
      context: req.context,
      projectId: req.params.projectId,
      fromPath: req.body.fromPath,
      toPath: req.body.toPath,
      statusCode: req.body.statusCode,
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'seo.redirect_created',
      targetType: 'WebsiteRedirect',
      targetId: redirect.id,
      metadata: { projectId: req.params.projectId, fromPath: redirect.fromPath, toPath: redirect.toPath },
      req,
    });

    return success(res, { redirect }, 'Redirect created');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function remove(req, res, next) {
  try {
    const redirect = await seoRedirectService.deleteRedirect(req.context, req.params.projectId, req.params.redirectId);

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'seo.redirect_deleted',
      targetType: 'WebsiteRedirect',
      targetId: redirect.id,
      metadata: { projectId: req.params.projectId, fromPath: redirect.fromPath },
      req,
    });

    return success(res, { removed: true });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { list, create, remove };

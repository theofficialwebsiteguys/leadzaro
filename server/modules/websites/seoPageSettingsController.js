'use strict';

const seoPageSettingsService = require('../seo/seoPageSettingsService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const pages = await seoPageSettingsService.listPageSettings(req.context, req.params.projectId);
    return success(res, { pages });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function get(req, res, next) {
  try {
    const settings = await seoPageSettingsService.getPageSettings(req.context, req.params.projectId, req.params.pageId);
    return success(res, { settings });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function upsert(req, res, next) {
  try {
    const settings = await seoPageSettingsService.upsertPageSettings({
      context: req.context,
      projectId: req.params.projectId,
      pageId: req.params.pageId,
      metaTitle: req.body.metaTitle,
      metaDescription: req.body.metaDescription,
      canonicalUrl: req.body.canonicalUrl,
      robotsDirective: req.body.robotsDirective,
      schemaJson: req.body.schemaJson,
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'seo.page_settings_updated',
      targetType: 'WebsitePageSeoSettings',
      targetId: settings.id,
      metadata: { projectId: req.params.projectId, pageId: req.params.pageId },
      req,
    });

    return success(res, { settings }, 'Page SEO settings updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function sitemap(req, res, next) {
  try {
    const xml = await seoPageSettingsService.generateSitemap(req.context, req.params.projectId);
    res.set('Content-Type', 'application/xml');
    return res.send(xml);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function robots(req, res, next) {
  try {
    const text = await seoPageSettingsService.generateRobotsTxt(req.context, req.params.projectId);
    res.set('Content-Type', 'text/plain');
    return res.send(text);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = {
  list, get, upsert, sitemap, robots,
};

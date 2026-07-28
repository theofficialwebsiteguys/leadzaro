'use strict';

const seoSearchConsoleService = require('../seo/seoSearchConsoleService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

async function set(req, res, next) {
  try {
    const website = await seoSearchConsoleService.setSearchConsoleProperty({
      context: req.context, projectId: req.params.projectId, propertyUrl: req.body.propertyUrl,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'seo.search_console_connected',
      targetType: 'Website',
      targetId: website.id,
      metadata: { projectId: req.params.projectId, connected: !!website.googleSearchConsolePropertyUrl },
      req,
    });

    return success(res, { website }, 'Google Search Console connection updated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = { set };

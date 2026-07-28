'use strict';

const websiteAnalyticsService = require('./websiteAnalyticsService');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function listEvents(req, res, next) {
  try {
    const events = await websiteAnalyticsService.listEvents(req.context, req.params.projectId);
    return success(res, { events });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function getSummary(req, res, next) {
  try {
    const rangeDays = req.query.rangeDays ? parseInt(req.query.rangeDays, 10) : undefined;
    const summary = await websiteAnalyticsService.getSummary(req.context, req.params.projectId, { rangeDays });
    return success(res, { summary });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function setGoogleAnalyticsMeasurementId(req, res, next) {
  try {
    const website = await websiteAnalyticsService.setGoogleAnalyticsMeasurementId({
      context: req.context, projectId: req.params.projectId, measurementId: req.body.measurementId,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'website.google_analytics_connected',
      targetType: 'Website',
      targetId: website.id,
      metadata: { projectId: req.params.projectId, connected: !!website.googleAnalyticsMeasurementId },
      req,
    });

    return success(res, { website }, 'Google Analytics connection updated');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = { listEvents, getSummary, setGoogleAnalyticsMeasurementId };

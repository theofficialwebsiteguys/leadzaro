'use strict';

const websitePublicAnalyticsService = require('./websitePublicAnalyticsService');
const { success, error } = require('../../utils/response');

async function record(req, res, next) {
  try {
    await websitePublicAnalyticsService.recordAnalyticsEvent({
      websiteId: req.params.websiteId,
      eventType: req.body.eventType,
      path: req.body.path,
      sessionId: req.body.sessionId,
      metadata: req.body.metadata,
    });
    return success(res, { recorded: true });
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = { record };

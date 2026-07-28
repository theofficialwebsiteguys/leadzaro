'use strict';

const seoDashboardService = require('../seo/seoDashboardService');
const { success, error } = require('../../utils/response');

async function get(req, res, next) {
  try {
    const dashboard = await seoDashboardService.getDashboard(req.context, req.params.projectId);
    return success(res, { dashboard });
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = { get };

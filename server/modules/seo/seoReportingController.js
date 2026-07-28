'use strict';

const seoDashboardService = require('./seoDashboardService');
const { success, error } = require('../../utils/response');

async function agencyOverview(req, res, next) {
  try {
    const overview = await seoDashboardService.getAgencySeoOverview(req.context);
    return success(res, { overview });
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = { agencyOverview };

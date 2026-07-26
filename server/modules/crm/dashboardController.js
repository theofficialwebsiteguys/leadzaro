'use strict';

const dashboardService = require('./dashboardService');
const { success } = require('../../utils/response');

async function getSummary(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    // crm.manage_pipeline is granted broadly to every sales rep (to manage
    // their own opportunities) — it is not a signal of manager-level
    // access. leads.assign is only granted to sales_manager/administrator
    // and is the correct gate for seeing every rep's individual numbers.
    const includeTeamBreakdown = req.context.permissionKeys.has('leads.assign');
    const summary = await dashboardService.getPipelineSummary(orgId, {
      userId: req.user.id, includeTeamBreakdown,
    });
    return success(res, summary);
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary };

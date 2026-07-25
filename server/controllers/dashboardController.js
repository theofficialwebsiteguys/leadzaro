const { SavedLead, OutreachActivity, Lead } = require('../models');
const { success } = require('../utils/response');
const { Op } = require('sequelize');

// Dashboard configuration per salesperson type
const DASHBOARD_CONFIG = {
  'Website Developer': {
    primaryMetric: 'noWebsiteLeads',
    quickFilters: ['No Website', 'Has Website', 'High Reviews', 'Nearby'],
    emphasis: 'website',
    tip: 'Focus on businesses without websites — they are your best prospects.',
  },
  'Marketing Agency': {
    primaryMetric: 'noWebsiteLeads',
    quickFilters: ['No Website', 'Low Reviews', 'Has Website', 'High Potential'],
    emphasis: 'online_presence',
    tip: 'Target businesses with low review counts and weak online presence.',
  },
  'Roofing Company': {
    primaryMetric: 'savedLeads',
    quickFilters: ['Nearby', 'Residential', 'Commercial', 'Follow Up'],
    emphasis: 'location',
    tip: 'Prioritize leads by proximity to your service area.',
  },
  'Real Estate Agent': {
    primaryMetric: 'savedLeads',
    quickFilters: ['Buyers', 'Sellers', 'Investors', 'Follow Up'],
    emphasis: 'location',
    tip: 'Track your pipeline by status to stay on top of every deal.',
  },
  'Insurance Agent': {
    primaryMetric: 'followUps',
    quickFilters: ['Follow Up', 'Interested', 'New Leads', 'Contacted'],
    emphasis: 'follow_up',
    tip: 'Consistent follow-ups close more policies. Never let a lead go cold.',
  },
  default: {
    primaryMetric: 'savedLeads',
    quickFilters: ['New', 'Follow Up', 'Interested', 'Contacted'],
    emphasis: 'general',
    tip: 'Stay organized — update your lead statuses daily.',
  },
};

async function getDashboard(req, res, next) {
  try {
    const organizationId = req.context.organization.id;
    const now = new Date();
    const activeScope = { organizationId, archivedAt: null, deletedAt: null };

    const [
      totalSaved,
      contacted,
      followUpsDue,
      interested,
      closed,
      noWebsiteLeads,
      recentActivity,
    ] = await Promise.all([
      SavedLead.count({ where: activeScope }),
      SavedLead.count({ where: { ...activeScope, status: 'Contacted' } }),
      SavedLead.count({ where: { ...activeScope, nextFollowUpAt: { [Op.lte]: now }, status: { [Op.notIn]: ['Closed', 'Archived'] } } }),
      SavedLead.count({ where: { ...activeScope, status: 'Interested' } }),
      SavedLead.count({ where: { ...activeScope, status: 'Closed' } }),
      SavedLead.count({
        where: activeScope,
        include: [{ model: Lead, as: 'lead', where: { hasWebsite: false }, required: true }],
      }),
      OutreachActivity.findAll({
        where: { organizationId, deletedAt: null },
        include: [{ model: Lead, as: 'lead', attributes: ['id', 'name', 'city'] }],
        order: [['createdAt', 'DESC']],
        limit: 5,
      }),
    ]);

    const config = DASHBOARD_CONFIG[req.user.salespersonType] || DASHBOARD_CONFIG.default;

    return success(res, {
      stats: {
        totalSaved,
        contacted,
        followUpsDue,
        interested,
        closed,
        noWebsiteLeads,
      },
      recentActivity,
      dashboardConfig: config,
      userType: req.user.salespersonType,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboard };

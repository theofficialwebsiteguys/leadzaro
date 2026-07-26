'use strict';

const {
  sequelize, Opportunity, User,
} = require('../../models');
const { STAGES, CLOSED_STAGES } = require('../../core/crm/pipelineCatalog');

/**
 * Pipeline health for the calling agency: stage distribution and win
 * rate (visible to anyone who can view the pipeline), the caller's own
 * assignment stats (always safe to show), and a per-rep team breakdown
 * that is only computed/returned when the caller has manager-level
 * visibility (`includeTeamBreakdown`) — the route decides that from the
 * caller's actual permission set, not the frontend.
 */
async function getPipelineSummary(agencyOrganizationId, { userId, includeTeamBreakdown }) {
  const baseWhere = { agencyOrganizationId, archivedAt: null, deletedAt: null };

  const stageCountsRaw = await Opportunity.findAll({
    where: baseWhere,
    attributes: ['stage', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['stage'],
    raw: true,
  });
  const stageCounts = STAGES.map((stage) => ({
    stage,
    count: Number(stageCountsRaw.find((r) => r.stage === stage)?.count || 0),
  }));

  const totalActive = stageCounts.reduce(
    (sum, s) => sum + (CLOSED_STAGES.has(s.stage) ? 0 : s.count), 0
  );
  const closedWon = stageCounts.find((s) => s.stage === 'Closed Won')?.count || 0;
  const closedLost = stageCounts.find((s) => s.stage === 'Closed Lost')?.count || 0;
  const winRate = (closedWon + closedLost) > 0
    ? Math.round((closedWon / (closedWon + closedLost)) * 100)
    : null;

  const myOpportunities = await Opportunity.findAll({
    where: { ...baseWhere, assignedToUserId: userId },
    attributes: ['stage', 'score'],
    raw: true,
  });
  const myOpen = myOpportunities.filter((o) => !CLOSED_STAGES.has(o.stage)).length;
  const myClosedWon = myOpportunities.filter((o) => o.stage === 'Closed Won').length;
  const scored = myOpportunities.filter((o) => o.score !== null && o.score !== undefined);
  const myAvgScore = scored.length
    ? Math.round(scored.reduce((sum, o) => sum + o.score, 0) / scored.length)
    : null;

  const summary = {
    stageCounts,
    totalActive,
    winRate,
    myStats: {
      assigned: myOpportunities.length, open: myOpen, closedWon: myClosedWon, avgScore: myAvgScore,
    },
    teamBreakdown: [],
  };

  if (includeTeamBreakdown) {
    const rows = await Opportunity.findAll({
      where: baseWhere,
      attributes: ['assignedToUserId', 'stage', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['assignedToUserId', 'stage'],
      raw: true,
    });

    const byUser = new Map();
    for (const row of rows) {
      if (!row.assignedToUserId) continue;
      if (!byUser.has(row.assignedToUserId)) byUser.set(row.assignedToUserId, { open: 0, closedWon: 0, closedLost: 0 });
      const entry = byUser.get(row.assignedToUserId);
      const count = Number(row.count);
      if (row.stage === 'Closed Won') entry.closedWon += count;
      else if (row.stage === 'Closed Lost') entry.closedLost += count;
      else entry.open += count;
    }

    const users = await User.findAll({ where: { id: [...byUser.keys()] }, attributes: ['id', 'name'] });
    summary.teamBreakdown = users
      .map((u) => ({ userId: u.id, name: u.name, ...byUser.get(u.id) }))
      .sort((a, b) => (b.open + b.closedWon) - (a.open + a.closedWon));
  }

  return summary;
}

module.exports = { getPipelineSummary };

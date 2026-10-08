'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize, User } = require('../../models');
const {
  STAGE_LABELS, CLOSE_REASONS, STALL_DAYS, stalledSql,
} = require('../../core/crm/pipelineCatalog');
const { clientBase } = require('../clients/clientStats');
const { localDateKey } = require('../clients/clientHealth');
const { CONNECTED_OUTCOMES } = require('./todayService');
const { invalid } = require('./salesCommon');
const { effectiveOffset, startOfLocalDate } = require('../../core/workspace/timezone');

/**
 * Sales reporting (ADR 0011). Every number states what it counts:
 * - attempts are recorded outbound interactions (sent, called, logged) —
 *   drafting or opening a composer is never counted; failed sends are not;
 * - credit follows who did the work (activities) or who the sale was
 *   attributed to when the payment request was made — reassigning a lead
 *   later does not move past credit;
 * - Stripe-confirmed and manually recorded payments are kept apart, and
 *   renewals are recurring revenue, never new sales;
 * - demo leads and Stripe test/mock payments are excluded unless asked for.
 */

/** Date range in the workspace timezone (or the viewer's), inclusive of both days. */
function range(query, offset = 0) {
  const valid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const to = valid(query.to) ? new Date(startOfLocalDate(query.to, offset).getTime() + 86400000 - 1) : new Date();
  const from = valid(query.from) ? startOfLocalDate(query.from, offset) : new Date(to.getTime() - 29 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw invalid('Choose a valid date range');
  if (to - from > 367 * 86400000) throw invalid('Reports cover at most one year at a time');
  return { from, to };
}

async function q(sql, replacements) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

async function getReport(ctx, query = {}) {
  const team = query.scope === 'team';
  if (team && !ctx.can('sales.view_team')) throw invalid('Team reports are for managers', 403);
  const userId = team ? (query.userId || null) : ctx.userId;
  const offset = effectiveOffset(ctx.timezone, query.tzOffset);
  const { from, to } = range(query, offset);
  const includeTest = query.includeTest === 'true';
  const r = {
    agencyId: ctx.agencyId, from, to, userId, connected: CONNECTED_OUTCOMES,
  };
  const testOpp = includeTest ? '' : 'AND COALESCE(o."isTest", false) = false';
  const testPay = includeTest ? '' : `AND COALESCE(p."stripeMode", 'live') NOT IN ('test', 'mock')`;
  const byUser = userId ? 'AND a."userId" = :userId' : '';
  const activityBase = `FROM "OutreachActivities" a LEFT JOIN "Opportunities" o ON o.id = a."opportunityId"
    WHERE a."organizationId" = :agencyId AND a."deletedAt" IS NULL AND a."createdAt" >= :from AND a."createdAt" <= :to ${testOpp} ${byUser}`;
  const counted = `AND COALESCE(a.status, '') NOT IN ('failed', 'undelivered', 'sending')`;

  const ownerOpp = userId ? 'AND o."assignedToUserId" = :userId' : '';
  const [newVsExisting, closeReasons, aging] = await Promise.all([
    // A first payment on a deal for a business that was already a client is a sale to an existing client, not a new client.
    q(`SELECT COUNT(*) FILTER (WHERE COALESCE(ca."createdNewClient", true))::int AS "newClients",
              COUNT(*) FILTER (WHERE ca."createdNewClient" = false)::int AS "existingClients"
       FROM "SalesPayments" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
       LEFT JOIN "ConversionAttempts" ca ON ca."opportunityId" = p."opportunityId" AND ca.status = 'completed'
       WHERE p."agencyOrganizationId" = :agencyId AND p.kind = 'initial' AND p."paidAt" >= :from AND p."paidAt" <= :to ${testOpp} ${testPay}
       ${userId ? 'AND p."attributedUserId" = :userId' : ''}`, r),
    q(`SELECT o.stage, COALESCE(o."closeReasonCode", 'other') AS code, COUNT(*)::int AS count
       FROM "Opportunities" o WHERE o."agencyOrganizationId" = :agencyId AND o."deletedAt" IS NULL AND o.stage IN ('lost', 'nurture')
       AND o."stageChangedAt" >= :from AND o."stageChangedAt" <= :to ${testOpp} ${ownerOpp} GROUP BY 1, 2 ORDER BY 3 DESC`, r),
    q(`SELECT o.stage, COUNT(*)::int AS count,
         ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - COALESCE(o."stageChangedAt", o."createdAt"))) / 86400))::int AS "avgDaysInStage",
         COUNT(*) FILTER (WHERE o."nextActionAt" IS NULL)::int AS "noNextStep",
         COUNT(*) FILTER (WHERE o."nextActionAt" < NOW())::int AS overdue,
         COUNT(*) FILTER (WHERE ${stalledSql('o')})::int AS stalled
       FROM "Opportunities" o WHERE o."agencyOrganizationId" = :agencyId AND o."deletedAt" IS NULL AND o."archivedAt" IS NULL AND o."doNotContact" = false
       AND o.stage IN ('new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'nurture') ${testOpp} ${ownerOpp} GROUP BY 1`, r),
  ]);

  const [attemptsByChannel, reach, followUps, meetings, offers, sales, renewals, handoffs, overdueNow, unverifiedWon, recurring] = await Promise.all([
    q(`SELECT COALESCE(a.channel, 'other') AS channel, a.origin, COUNT(*)::int AS count ${activityBase} AND a.direction = 'outbound' ${counted} GROUP BY 1, 2 ORDER BY 1`, r),
    q(`SELECT COUNT(DISTINCT CASE WHEN a.direction = 'outbound' THEN COALESCE(o."organizationId"::text, a."leadId"::text) END)::int AS contacted,
              COUNT(DISTINCT CASE WHEN a.direction = 'inbound' OR a.outcome IN (:connected) THEN COALESCE(o."organizationId"::text, a."leadId"::text) END)::int AS reached,
              COUNT(*) FILTER (WHERE a.direction = 'inbound')::int AS replies
       ${activityBase} ${counted}`, r),
    q(`SELECT COUNT(*) FILTER (WHERE a."completedFollowUp")::int AS completed ${activityBase}`, r),
    q(`SELECT COUNT(*)::int AS count ${activityBase} AND a.outcome = 'meeting_arranged'`, r),
    q(`SELECT COUNT(DISTINCT p."opportunityId")::int AS count FROM "PaymentLinkRequests" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
       WHERE p."agencyOrganizationId" = :agencyId AND p."createdAt" >= :from AND p."createdAt" <= :to AND p.status NOT IN ('creating', 'failed') ${testOpp} ${testPay}
       ${userId ? 'AND p."attributedUserId" = :userId' : ''}`, r),
    q(`SELECT p.source, p.currency, COUNT(*)::int AS count, SUM(p."amountCents" - p."amountRefundedCents")::bigint AS amount
       FROM "SalesPayments" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
       WHERE p."agencyOrganizationId" = :agencyId AND p.kind = 'initial' AND p."paidAt" >= :from AND p."paidAt" <= :to ${testOpp} ${testPay}
       ${userId ? 'AND p."attributedUserId" = :userId' : ''} GROUP BY 1, 2`, r),
    q(`SELECT p.currency, COUNT(*)::int AS count, SUM(p."amountCents" - p."amountRefundedCents")::bigint AS amount
       FROM "SalesPayments" p WHERE p."agencyOrganizationId" = :agencyId AND p.kind IN ('renewal', 'other') AND p."paidAt" >= :from AND p."paidAt" <= :to ${testPay}
       ${userId ? 'AND p."attributedUserId" = :userId' : ''} GROUP BY 1`, r),
    q(`SELECT COUNT(*)::int AS count FROM "SalesHandoffs" h JOIN "Opportunities" o ON o.id = h."opportunityId"
       WHERE h."agencyOrganizationId" = :agencyId AND h.status = 'complete' AND h."completedAt" >= :from AND h."completedAt" <= :to ${testOpp}
       ${userId ? 'AND COALESCE(o."creditedUserId", o."assignedToUserId") = :userId' : ''}`, r),
    q(`SELECT COUNT(*)::int AS count FROM "Opportunities" o WHERE o."agencyOrganizationId" = :agencyId AND o."deletedAt" IS NULL AND o."archivedAt" IS NULL
       AND o."doNotContact" = false AND o.stage NOT IN ('won', 'lost') AND o."nextActionAt" < NOW() ${testOpp} ${userId ? 'AND o."assignedToUserId" = :userId' : ''}`, r),
    q(`SELECT COUNT(*)::int AS count FROM "Opportunities" o WHERE o."agencyOrganizationId" = :agencyId AND o."deletedAt" IS NULL AND o.stage = 'won'
       AND NOT EXISTS (SELECT 1 FROM "SalesPayments" p WHERE p."opportunityId" = o.id AND p.kind = 'initial') ${testOpp}
       ${userId ? 'AND COALESCE(o."creditedUserId", o."assignedToUserId") = :userId' : ''}`, r),
    team && !userId ? q(`SELECT s.currency, COUNT(*)::int AS count,
         SUM(CASE WHEN s.interval = 'year' THEN s."amountCents" / 12.0 ELSE s."amountCents" END)::bigint AS monthly
       FROM "Subscriptions" s JOIN "BillingAccounts" b ON b.id = s."billingAccountId" JOIN "Organizations" org ON org.id = b."organizationId"
       WHERE org."managingAgencyOrganizationId" = :agencyId AND s.status IN ('active', 'past_due') AND s."amountCents" IS NOT NULL
       ${includeTest ? '' : `AND COALESCE(s."stripeMode", 'live') NOT IN ('test', 'mock')`} GROUP BY 1`, r) : Promise.resolve(null),
  ]);

  const attempts = attemptsByChannel.reduce((sum, row) => sum + row.count, 0);
  const paid = {
    stripe: sales.filter((s) => s.source === 'stripe').reduce((sum, s) => sum + s.count, 0),
    manual: sales.filter((s) => s.source === 'manual').reduce((sum, s) => sum + s.count, 0),
    amounts: sales.map((s) => ({ source: s.source, currency: s.currency, amountCents: Number(s.amount) })),
  };
  const report = {
    scope: team ? 'team' : 'mine',
    userId,
    from,
    to,
    includeTest,
    attempts: { total: attempts, byChannel: attemptsByChannel },
    businessesContacted: reach[0].contacted,
    businessesReached: reach[0].reached,
    repliesReceived: reach[0].replies,
    reachRate: reach[0].contacted ? { numerator: reach[0].reached, denominator: reach[0].contacted } : null,
    followUpsCompleted: followUps[0].completed,
    followUpsOverdueNow: overdueNow[0].count,
    meetings: meetings[0].count,
    offers: offers[0].count,
    paidSales: {
      total: paid.stripe + paid.manual, stripe: paid.stripe, manual: paid.manual, amounts: paid.amounts, newClients: newVsExisting[0].newClients, existingClients: newVsExisting[0].existingClients,
    },
    closeReasons: closeReasons.map((row) => ({
      stage: row.stage, code: row.code, label: CLOSE_REASONS[row.code] || row.code, count: row.count,
    })),
    pipelineAging: ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'nurture'].map((stage) => {
      const row = aging.find((a) => a.stage === stage) || {};
      return {
        stage, label: STAGE_LABELS[stage], count: row.count || 0, avgDaysInStage: row.avgDaysInStage ?? null, noNextStep: row.noNextStep || 0, overdue: row.overdue || 0, stalled: row.stalled || 0, stallDays: STALL_DAYS[stage] || null,
      };
    }),
    clients: null,
    closeRate: offers[0].count ? { numerator: paid.stripe + paid.manual, denominator: offers[0].count } : null,
    renewals: renewals.map((row) => ({ currency: row.currency, count: row.count, amountCents: Number(row.amount) })),
    handoffsCompleted: handoffs[0].count,
    wonWithoutPaymentRecord: unverifiedWon[0].count,
    recurringNow: recurring ? recurring.map((row) => ({ currency: row.currency, subscriptions: row.count, monthlyCents: Number(row.monthly) })) : null,
    team: null,
    recentSales: await recentSales(ctx, r, { testOpp, testPay }),
  };
  if (team && !userId) report.team = await teamBreakdown(ctx, r, { testOpp, testPay, counted });
  if (team && !userId && ctx.can('projects.view')) {
    report.clients = await clientBase(ctx.authContext, {
      from, to, includeTest, todayKey: localDateKey(offset), goal: ctx.authContext.organization.settings?.clientGoal || 100,
    });
  }
  return report;
}

async function recentSales(ctx, r, { testOpp, testPay }) {
  const rows = await q(`SELECT p.id, p."opportunityId", p."organizationId", p.source, p."amountCents", p."amountRefundedCents", p.currency, p."paidAt", p.method,
      org.name AS "businessName", u.name AS "attributedTo", COALESCE(ca."createdNewClient", true) AS "newClient"
    FROM "SalesPayments" p JOIN "Organizations" org ON org.id = p."organizationId"
    LEFT JOIN "Opportunities" o ON o.id = p."opportunityId" LEFT JOIN "Users" u ON u.id = p."attributedUserId"
    LEFT JOIN "ConversionAttempts" ca ON ca."opportunityId" = p."opportunityId" AND ca.status = 'completed'
    WHERE p."agencyOrganizationId" = :agencyId AND p.kind = 'initial' AND p."paidAt" >= :from AND p."paidAt" <= :to ${testOpp} ${testPay}
    ${r.userId ? 'AND p."attributedUserId" = :userId' : ''}
    ORDER BY p."paidAt" DESC LIMIT 25`, r);
  return rows;
}

async function teamBreakdown(ctx, r, { testOpp, testPay, counted }) {
  const [activity, sales, offers, handoffs, open] = await Promise.all([
    q(`SELECT a."userId",
         COUNT(*) FILTER (WHERE a.direction = 'outbound')::int AS attempts,
         COUNT(DISTINCT CASE WHEN a.direction = 'outbound' THEN COALESCE(o."organizationId"::text, a."leadId"::text) END)::int AS contacted,
         COUNT(DISTINCT CASE WHEN a.direction = 'inbound' OR a.outcome IN (:connected) THEN COALESCE(o."organizationId"::text, a."leadId"::text) END)::int AS reached,
         COUNT(*) FILTER (WHERE a.outcome = 'meeting_arranged')::int AS meetings,
         COUNT(*) FILTER (WHERE a."completedFollowUp")::int AS "followUps"
       FROM "OutreachActivities" a LEFT JOIN "Opportunities" o ON o.id = a."opportunityId"
       WHERE a."organizationId" = :agencyId AND a."deletedAt" IS NULL AND a."createdAt" >= :from AND a."createdAt" <= :to ${testOpp} ${counted}
       GROUP BY 1`, r),
    q(`SELECT p."attributedUserId" AS "userId", COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE p.source = 'manual')::int AS manual, SUM(p."amountCents" - p."amountRefundedCents")::bigint AS amount
       FROM "SalesPayments" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
       WHERE p."agencyOrganizationId" = :agencyId AND p.kind = 'initial' AND p."paidAt" >= :from AND p."paidAt" <= :to ${testOpp} ${testPay} GROUP BY 1`, r),
    q(`SELECT p."attributedUserId" AS "userId", COUNT(DISTINCT p."opportunityId")::int AS count FROM "PaymentLinkRequests" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
       WHERE p."agencyOrganizationId" = :agencyId AND p."createdAt" >= :from AND p."createdAt" <= :to AND p.status NOT IN ('creating', 'failed') ${testOpp} ${testPay} GROUP BY 1`, r),
    q(`SELECT COALESCE(o."creditedUserId", o."assignedToUserId") AS "userId", COUNT(*)::int AS count FROM "SalesHandoffs" h JOIN "Opportunities" o ON o.id = h."opportunityId"
       WHERE h."agencyOrganizationId" = :agencyId AND h.status = 'complete' AND h."completedAt" >= :from AND h."completedAt" <= :to ${testOpp} GROUP BY 1`, r),
    q(`SELECT o."assignedToUserId" AS "userId", COUNT(*)::int AS open,
         COUNT(*) FILTER (WHERE o."nextActionAt" < NOW())::int AS overdue
       FROM "Opportunities" o WHERE o."agencyOrganizationId" = :agencyId AND o."deletedAt" IS NULL AND o."archivedAt" IS NULL AND o."doNotContact" = false
       AND o.stage NOT IN ('won', 'lost') ${testOpp} GROUP BY 1`, r),
  ]);
  const ids = new Set([...activity, ...sales, ...offers, ...handoffs, ...open].map((row) => row.userId).filter(Boolean));
  const users = await User.findAll({ where: { id: [...ids] }, attributes: ['id', 'name'] });
  const pick = (rows, id) => rows.find((row) => row.userId === id) || {};
  return users.map((u) => {
    const a = pick(activity, u.id);
    const s = pick(sales, u.id);
    const o = pick(open, u.id);
    return {
      userId: u.id,
      name: u.name,
      attempts: a.attempts || 0,
      contacted: a.contacted || 0,
      reached: a.reached || 0,
      meetings: a.meetings || 0,
      followUps: a.followUps || 0,
      offers: pick(offers, u.id).count || 0,
      paidSales: s.count || 0,
      manualSales: s.manual || 0,
      salesAmountCents: Number(s.amount || 0),
      handoffs: pick(handoffs, u.id).count || 0,
      openLeads: o.open || 0,
      overdue: o.overdue || 0,
    };
  }).sort((x, y) => y.paidSales - x.paidSales || y.attempts - x.attempts);
}

/** Stage counts for the Leads board header. */
async function stageCounts(ctx, { mine } = {}) {
  const rows = await q(`SELECT stage, COUNT(*)::int AS count FROM "Opportunities"
    WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "archivedAt" IS NULL ${mine ? 'AND "assignedToUserId" = :userId' : ''}
    GROUP BY stage`, { agencyId: ctx.agencyId, userId: ctx.userId });
  return Object.keys(STAGE_LABELS).map((stage) => ({ stage, label: STAGE_LABELS[stage], count: rows.find((row) => row.stage === stage)?.count || 0 }));
}

module.exports = { getReport, stageCounts, range };

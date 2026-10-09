'use strict';

const { Op } = require('sequelize');
const {
  Opportunity, Organization, User, PaymentLinkRequest, SalesHandoff, OutreachActivity, SalesPayment, SalesGoal,
} = require('../../models');
const { STAGE_LABELS, OUTCOMES, stallInfo } = require('../../core/crm/pipelineCatalog');
const { invalid } = require('./salesCommon');
const { effectiveOffset } = require('../../core/workspace/timezone');

/**
 * Today and the work queue (ADR 0011). Both are computed from the same
 * recorded facts (next actions, replies, payment requests, handoffs) — no
 * separate task list to keep in sync.
 */

const OPEN_STAGES = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'nurture'];
const PRIORITY = {
  reply: { rank: 1, label: 'Reply needed' },
  overdue: { rank: 2, label: 'Overdue' },
  due_today: { rank: 3, label: 'Due today' },
  payment: { rank: 4, label: 'Payment follow-up' },
  stalled: { rank: 5, label: 'Stalled deal' },
  new_lead: { rank: 6, label: 'New lead' },
  no_next_step: { rank: 7, label: 'No next step' },
};
const CONNECTED_OUTCOMES = Object.entries(OUTCOMES).filter(([, o]) => o.connected).map(([k]) => k);

/** Day boundaries in the viewer's time zone (offset in minutes, as Date#getTimezoneOffset returns). */
function dayBounds(tzOffset) {
  const offset = Number.isFinite(Number(tzOffset)) ? Math.max(-840, Math.min(840, Number(tzOffset))) : 0;
  const nowLocal = new Date(Date.now() - offset * 60000);
  const startLocal = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate());
  const start = new Date(startLocal + offset * 60000);
  const end = new Date(start.getTime() + 86400000);
  const weekday = (nowLocal.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(start.getTime() - weekday * 86400000);
  return { start, end, weekStart };
}

function ownerWhere(ctx, scope, userId) {
  if (scope === 'team' && ctx.can('sales.view_team')) return userId ? { assignedToUserId: userId } : {};
  return { assignedToUserId: ctx.userId };
}

const OPP_INCLUDE = [
  { model: Organization, as: 'organization', attributes: ['id', 'name', 'type', 'phone', 'email', 'city', 'state'] },
  { model: User, as: 'assignedTo', attributes: ['id', 'name'] },
];

function card(o, extra = {}) {
  return {
    opportunityId: o.id,
    businessName: o.organization?.name,
    city: o.organization?.city || null,
    state: o.organization?.state || null,
    title: o.title,
    stage: o.stage,
    stageLabel: STAGE_LABELS[o.stage],
    assignedTo: o.assignedTo ? { id: o.assignedTo.id, name: o.assignedTo.name } : null,
    nextActionAt: o.nextActionAt,
    nextActionType: o.nextActionType,
    nextActionNote: o.nextActionNote,
    lastInteractionAt: o.lastInteractionAt,
    lastInteractionSummary: o.lastInteractionSummary,
    replyNeededSince: o.replyNeededSince,
    valueCents: o.valueCents,
    currency: o.currency,
    hasPhone: Boolean(o.organization?.phone),
    hasEmail: Boolean(o.organization?.email),
    stall: stallInfo(o),
    ...extra,
  };
}

async function openOpportunities(ctx, scope, userId, extraWhere) {
  return Opportunity.findAll({
    where: {
      agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, doNotContact: false, stage: OPEN_STAGES, ...ownerWhere(ctx, scope, userId), ...extraWhere,
    },
    include: OPP_INCLUDE,
    order: [['nextActionAt', 'ASC NULLS LAST'], ['updatedAt', 'DESC']],
    limit: 300,
  });
}

async function weeklyProgress(ctx, userId, weekStart) {
  const since = { [Op.gte]: weekStart };
  const [attempts, conversations, meetings, paidSales, goals] = await Promise.all([
    OutreachActivity.count({
      where: {
        organizationId: ctx.agencyId, userId, direction: 'outbound', deletedAt: null, createdAt: since, status: { [Op.or]: [{ [Op.is]: null }, { [Op.notIn]: ['failed', 'undelivered', 'sending'] }] },
      },
    }),
    OutreachActivity.count({ where: { organizationId: ctx.agencyId, userId, outcome: CONNECTED_OUTCOMES, deletedAt: null, createdAt: since } }),
    OutreachActivity.count({ where: { organizationId: ctx.agencyId, userId, outcome: 'meeting_arranged', deletedAt: null, createdAt: since } }),
    SalesPayment.count({ where: { agencyOrganizationId: ctx.agencyId, attributedUserId: userId, kind: 'initial', paidAt: since } }),
    SalesGoal.findAll({ where: { agencyOrganizationId: ctx.agencyId, period: 'week', userId: { [Op.or]: [userId, null] } } }),
  ]);
  const actual = {
    attempts, conversations, meetings, paid_sales: paidSales,
  };
  const labels = {
    attempts: 'Outreach attempts', conversations: 'Conversations', meetings: 'Meetings booked', paid_sales: 'Paid sales',
  };
  return Object.keys(actual).map((metric) => {
    const own = goals.find((g) => g.metric === metric && g.userId === userId);
    const team = goals.find((g) => g.metric === metric && g.userId === null);
    const target = (own || team)?.target ?? null;
    return {
      metric, label: labels[metric], actual: actual[metric], target, source: own ? 'personal' : (team ? 'team' : null),
    };
  });
}

async function getToday(ctx, { scope = 'mine', userId, tzOffset } = {}) {
  const { start, end, weekStart } = dayBounds(effectiveOffset(ctx.timezone, tzOffset));
  const opps = await openOpportunities(ctx, scope, userId);
  const ids = opps.map((o) => o.id);

  const replies = opps.filter((o) => o.replyNeededSince).sort((a, b) => a.replyNeededSince - b.replyNeededSince);
  const overdue = opps.filter((o) => !o.replyNeededSince && o.nextActionAt && o.nextActionAt < start);
  const dueToday = opps.filter((o) => !o.replyNeededSince && o.nextActionAt && o.nextActionAt >= start && o.nextActionAt < end);
  const newLeads = opps.filter((o) => o.stage === 'new' && !o.lastInteractionAt && !o.nextActionAt);
  const stale = Date.now() - 7 * 86400000;
  const activeDeals = opps.filter((o) => ['qualified', 'proposal'].includes(o.stage) && !o.replyNeededSince && (!o.nextActionAt || (o.lastInteractionAt && o.lastInteractionAt.getTime() < stale && o.nextActionAt >= end)));

  const requests = ids.length ? await PaymentLinkRequest.findAll({
    where: { opportunityId: ids, status: ['created', 'sent', 'processing', 'failed', 'expired'], replacedByRequestId: null },
    order: [['createdAt', 'DESC']],
  }) : [];
  const payments = [];
  const seen = new Set();
  for (const request of requests) {
    if (seen.has(request.opportunityId)) continue;
    seen.add(request.opportunityId);
    const o = opps.find((x) => x.id === request.opportunityId);
    const expired = request.kind === 'checkout_session' && request.expiresAt && request.expiresAt < new Date() && ['created', 'sent'].includes(request.status);
    const status = expired ? 'expired' : request.status;
    payments.push(card(o, {
      paymentRequestId: request.id,
      paymentStatus: status,
      paymentLabel: {
        created: 'Link created — not sent', sent: 'Sent — awaiting payment', processing: 'Payment processing', failed: 'Payment failed', expired: 'Checkout expired',
      }[status],
      amountCents: request.initialAmountCents,
      currency: request.currency,
      sentAt: request.sentAt,
    }));
  }

  const handoffOwner = scope === 'team' && ctx.can('sales.view_team') ? (userId ? { [Op.or]: [{ creditedUserId: userId }, { assignedToUserId: userId }] } : {}) : { [Op.or]: [{ creditedUserId: ctx.userId }, { assignedToUserId: ctx.userId }] };
  const handoffs = await SalesHandoff.findAll({
    where: { agencyOrganizationId: ctx.agencyId, status: ['pending', 'needs_info', 'failed'] },
    include: [{
      model: Opportunity, as: 'opportunity', where: { deletedAt: null, ...handoffOwner }, include: OPP_INCLUDE,
    }],
    order: [['createdAt', 'ASC']],
    limit: 50,
  });

  // Stalled (ADR 0013): open deals with no recorded activity for longer
  // than their stage allows, not already listed above for another reason.
  const listed = new Set([...replies, ...overdue, ...dueToday].map((o) => o.id));
  for (const p of payments) listed.add(p.opportunityId);
  const stalled = opps
    .map((o) => ({ o, stall: stallInfo(o) }))
    .filter(({ o, stall }) => stall && !listed.has(o.id) && o.stage !== 'new')
    .sort((a, b) => b.stall.days - a.stall.days);

  const unclaimed = await Opportunity.count({
    where: {
      agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, assignedToUserId: null, stage: 'new', doNotContact: false,
    },
  });

  return {
    generatedAt: new Date(),
    scope: scope === 'team' && ctx.can('sales.view_team') ? 'team' : 'mine',
    replies: replies.map((o) => card(o)),
    overdue: overdue.map((o) => card(o)),
    dueToday: dueToday.map((o) => card(o)),
    newLeads: newLeads.slice(0, 25).map((o) => card(o)),
    newLeadsTotal: newLeads.length,
    activeDeals: activeDeals.filter((o) => !stalled.some((s) => s.o.id === o.id)).map((o) => card(o)),
    stalled: stalled.slice(0, 20).map(({ o }) => card(o)),
    stalledTotal: stalled.length,
    payments,
    handoffs: handoffs.map((h) => card(h.opportunity, {
      handoffStatus: h.status, missingEssential: (h.items || []).filter((i) => i.essential && !i.done).length, handoffError: h.lastError,
    })),
    unclaimed,
    goals: await weeklyProgress(ctx, scope === 'team' && userId ? userId : ctx.userId, weekStart),
    queueSize: (await buildQueue(ctx, { scope, userId, tzOffset }, opps)).length,
  };
}

/**
 * The ordered work queue behind “Work next lead”. One entry per lead, at
 * its most urgent reason. Filters narrow by reason or stage.
 */
async function buildQueue(ctx, { scope = 'mine', userId, tzOffset, reasons, stage } = {}, preloaded = null) {
  const { start, end } = dayBounds(effectiveOffset(ctx.timezone, tzOffset));
  const opps = preloaded || await openOpportunities(ctx, scope, userId);
  const ids = opps.map((o) => o.id);
  const openRequests = ids.length ? await PaymentLinkRequest.findAll({
    where: { opportunityId: ids, status: ['created', 'sent', 'failed', 'expired'], replacedByRequestId: null },
    attributes: ['opportunityId', 'status', 'sentAt', 'kind', 'expiresAt'],
  }) : [];
  const staleSend = Date.now() - 2 * 86400000;

  const entries = [];
  for (const o of opps) {
    let reason = null;
    const request = openRequests.find((r) => r.opportunityId === o.id);
    if (o.replyNeededSince) reason = 'reply';
    else if (o.nextActionAt && o.nextActionAt < start) reason = 'overdue';
    else if (o.nextActionAt && o.nextActionAt < end) reason = 'due_today';
    else if (request && (request.status === 'created' || ['failed', 'expired'].includes(request.status) || (request.sentAt && request.sentAt.getTime() < staleSend))) reason = 'payment';
    else if (o.stage !== 'new' && stallInfo(o)) reason = 'stalled';
    else if (o.stage === 'new' && !o.lastInteractionAt && !o.nextActionAt) reason = 'new_lead';
    else if (!o.nextActionAt && o.stage !== 'nurture') reason = 'no_next_step';
    if (!reason) continue;
    if (Array.isArray(reasons) && reasons.length && !reasons.includes(reason)) continue;
    if (stage && o.stage !== stage) continue;
    entries.push({
      opportunityId: o.id,
      businessName: o.organization?.name,
      city: o.organization?.city || null,
      state: o.organization?.state || null,
      stage: o.stage,
      stageLabel: STAGE_LABELS[o.stage],
      reason,
      label: PRIORITY[reason].label,
      rank: PRIORITY[reason].rank,
      dueAt: o.nextActionAt,
      since: o.replyNeededSince,
    });
  }
  entries.sort((a, b) => a.rank - b.rank
    || (a.since && b.since ? new Date(a.since) - new Date(b.since) : 0)
    || (a.dueAt && b.dueAt ? new Date(a.dueAt) - new Date(b.dueAt) : 0)
    || a.businessName.localeCompare(b.businessName));
  return entries;
}

async function getQueue(ctx, query = {}) {
  const reasons = query.reasons ? String(query.reasons).split(',').filter((r) => PRIORITY[r]) : [];
  const items = await buildQueue(ctx, {
    scope: query.scope, userId: query.userId, tzOffset: query.tzOffset, reasons, stage: query.stage || undefined,
  });
  return { items, reasons: Object.entries(PRIORITY).map(([key, v]) => ({ key, label: v.label })) };
}

// ---------------------------------------------------------------- goals

async function listGoals(ctx) {
  const goals = await SalesGoal.findAll({ where: { agencyOrganizationId: ctx.agencyId, period: 'week' } });
  return goals;
}

async function setGoal(ctx, { userId = null, metric, target }) {
  if (!SalesGoal.METRICS.includes(metric)) throw invalid('Unknown goal');
  const value = target === null || target === '' ? null : Number(target);
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 10000)) throw invalid('Goals must be whole numbers from 0 to 10,000');
  if (userId && userId !== ctx.userId && !ctx.can('sales.view_team')) throw invalid('Only managers can set goals for others', 403);
  if (!userId && !ctx.can('sales.view_team')) throw invalid('Only managers can set the team goal', 403);
  const where = {
    agencyOrganizationId: ctx.agencyId, userId: userId || null, metric, period: 'week',
  };
  const existing = await SalesGoal.findOne({ where });
  if (value === null) {
    if (existing) await existing.destroy();
    return listGoals(ctx);
  }
  if (existing) await existing.update({ target: value, updatedByUserId: ctx.userId });
  else await SalesGoal.create({ ...where, target: value, updatedByUserId: ctx.userId });
  return listGoals(ctx);
}

module.exports = {
  getToday, getQueue, buildQueue, dayBounds, listGoals, setGoal, CONNECTED_OUTCOMES,
};

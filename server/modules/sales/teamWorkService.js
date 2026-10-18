'use strict';

const { Op, QueryTypes } = require('sequelize');
const {
  sequelize, WorkCredit, Opportunity, Organization, User, OutreachActivity, SalesPayment,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const { OUTCOMES, STAGE_LABELS, QUALIFICATION_LABELS } = require('../../core/crm/pipelineCatalog');
const { activeMembers } = require('./teamMembers');
const workSessions = require('./workSessionService');
const { invalid, assertNoSecrets } = require('./salesCommon');

/**
 * Who did what, and when (ADR 0016): qualifier and sales work per person
 * over a date range, the qualification credits awaiting compensation
 * review, and drill-downs to the underlying records. Counts come from
 * recorded facts only; credit is attributed to the original contributor
 * and never moves with reassignment.
 */

const CONNECTED = Object.entries(OUTCOMES).filter(([, o]) => o.connected).map(([k]) => k);
const NOT_SENT = ['failed', 'undelivered', 'sending', 'draft'];

async function q(sql, replacements) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

function byUser(rows, field = 'count') {
  return Object.fromEntries(rows.map((r) => [r.userId, Number(r[field]) || 0]));
}

async function report(ctx, query = {}) {
  const { from, to } = workSessions.range(query);
  const r = {
    agencyId: ctx.agencyId, from, to, connected: CONNECTED, notSent: NOT_SENT,
  };
  const members = (await activeMembers(ctx.agencyId)).filter((m) => !query.userId || m.id === query.userId);

  const [researched, credits, unsuitable, duplicates] = await Promise.all([
    q(`SELECT "researcherUserId" AS "userId", COUNT(*)::int AS count FROM "Opportunities"
       WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "researcherUserId" IS NOT NULL AND "createdAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT c."userId",
         COUNT(*)::int AS completed,
         COUNT(*) FILTER (WHERE o."qualificationStatus" = 'assigned')::int AS assigned,
         COUNT(*) FILTER (WHERE c.status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE c.status IN ('accepted', 'paid'))::int AS accepted,
         COUNT(*) FILTER (WHERE c.status = 'needs_correction')::int AS "needsCorrection",
         COUNT(*) FILTER (WHERE c.status = 'rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE c.status = 'paid')::int AS paid,
         COALESCE(SUM(c."correctionCount"), 0)::int AS returned,
         COUNT(*) FILTER (WHERE o."lastInteractionAt" IS NOT NULL)::int AS "dContacted",
         COUNT(*) FILTER (WHERE o.meeting IS NOT NULL)::int AS "dMeetings",
         COUNT(*) FILTER (WHERE o."paymentConfirmedAt" IS NOT NULL)::int AS "dPaid",
         COUNT(*) FILTER (WHERE o.stage = 'won')::int AS "dWon"
       FROM "WorkCredits" c JOIN "Opportunities" o ON o.id = c."opportunityId"
       WHERE c."agencyOrganizationId" = :agencyId AND c.kind = 'qualification' AND c."earnedAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT "researcherUserId" AS "userId", COUNT(*)::int AS count FROM "Opportunities"
       WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "qualificationStatus" = 'unsuitable' AND "updatedAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT "researcherUserId" AS "userId", COUNT(*)::int AS count FROM "Opportunities"
       WHERE "agencyOrganizationId" = :agencyId AND "researcherUserId" IS NOT NULL AND ("closeReasonCode" = 'duplicate' OR "mergedIntoOpportunityId" IS NOT NULL)
       AND "updatedAt" BETWEEN :from AND :to GROUP BY 1`, r),
  ]);

  const [attempts, contacted, conversations, replies, followUps, overdue, assignedOpen, meetings, pricing, payments, approved] = await Promise.all([
    q(`SELECT "userId", COALESCE(channel, 'other') AS channel, COUNT(*)::int AS count FROM "OutreachActivities"
       WHERE "organizationId" = :agencyId AND "deletedAt" IS NULL AND direction = 'outbound' AND "createdAt" BETWEEN :from AND :to
       AND (status IS NULL OR status NOT IN (:notSent)) AND "userId" IS NOT NULL GROUP BY 1, 2`, r),
    q(`SELECT "userId", COUNT(DISTINCT "opportunityId")::int AS count FROM "OutreachActivities"
       WHERE "organizationId" = :agencyId AND "deletedAt" IS NULL AND direction = 'outbound' AND "createdAt" BETWEEN :from AND :to
       AND (status IS NULL OR status NOT IN (:notSent)) AND "opportunityId" IS NOT NULL GROUP BY 1`, r),
    q(`SELECT "userId", COUNT(*)::int AS count FROM "OutreachActivities"
       WHERE "organizationId" = :agencyId AND "deletedAt" IS NULL AND outcome IN (:connected) AND "createdAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT o."assignedToUserId" AS "userId", COUNT(*)::int AS count FROM "OutreachActivities" a JOIN "Opportunities" o ON o.id = a."opportunityId"
       WHERE a."organizationId" = :agencyId AND a."deletedAt" IS NULL AND a.direction = 'inbound' AND a."createdAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT "userId", COUNT(*)::int AS count FROM "OutreachActivities"
       WHERE "organizationId" = :agencyId AND "deletedAt" IS NULL AND "completedFollowUp" = true AND "createdAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT "assignedToUserId" AS "userId", COUNT(*)::int AS count FROM "Opportunities"
       WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "archivedAt" IS NULL AND "doNotContact" = false
       AND stage NOT IN ('won', 'lost') AND "nextActionAt" < NOW() AND ("qualificationStatus" IS NULL OR "qualificationStatus" = 'assigned') GROUP BY 1`, r),
    q(`SELECT "assignedToUserId" AS "userId", COUNT(*)::int AS count FROM "Opportunities"
       WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "archivedAt" IS NULL AND stage NOT IN ('won', 'lost')
       AND ("qualificationStatus" IS NULL OR "qualificationStatus" = 'assigned') GROUP BY 1`, r),
    q(`SELECT "userId", COUNT(*)::int AS count FROM "OutreachActivities"
       WHERE "organizationId" = :agencyId AND "deletedAt" IS NULL AND outcome = 'meeting_arranged' AND "createdAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT COALESCE(("proposal"->>'sentBy')::uuid, "assignedToUserId") AS "userId", COUNT(*)::int AS count FROM "Opportunities"
       WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND ("proposal"->>'sentAt') IS NOT NULL
       AND ("proposal"->>'sentAt')::timestamptz BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT "attributedUserId" AS "userId", COUNT(*)::int AS count, COALESCE(SUM("amountCents" - "amountRefundedCents"), 0)::int AS cents FROM "SalesPayments"
       WHERE "agencyOrganizationId" = :agencyId AND kind = 'initial' AND "paidAt" BETWEEN :from AND :to GROUP BY 1`, r),
    q(`SELECT COALESCE("creditedUserId", "assignedToUserId") AS "userId", COUNT(*)::int AS count FROM "Opportunities"
       WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "closingStatus" = 'approved' AND "closingReviewedAt" BETWEEN :from AND :to GROUP BY 1`, r),
  ]);
  const time = await workSessions.minutesByUser(ctx.agencyId, from, to);

  const creditsBy = Object.fromEntries(credits.map((c) => [c.userId, c]));
  const people = members.map((m) => {
    const c = creditsBy[m.id] || {};
    const channels = attempts.filter((a) => a.userId === m.id).map((a) => ({ channel: a.channel, count: a.count }));
    return {
      user: { id: m.id, name: m.name, roles: m.roles },
      does: {
        qualifying: m.permissionKeys.has('qualification.work'),
        selling: m.permissionKeys.has('outreach.send'),
      },
      qualifier: {
        researched: byUser(researched)[m.id] || 0,
        completed: c.completed || 0,
        assigned: c.assigned || 0,
        pending: c.pending || 0,
        accepted: c.accepted || 0,
        needsCorrection: c.needsCorrection || 0,
        rejected: c.rejected || 0,
        paid: c.paid || 0,
        returned: c.returned || 0,
        unsuitable: byUser(unsuitable)[m.id] || 0,
        duplicates: byUser(duplicates)[m.id] || 0,
        downstream: {
          contacted: c.dContacted || 0, meetings: c.dMeetings || 0, paymentConfirmed: c.dPaid || 0, won: c.dWon || 0,
        },
      },
      sales: {
        assignedOpen: byUser(assignedOpen)[m.id] || 0,
        attempts: channels.reduce((s, a) => s + a.count, 0),
        attemptsByChannel: channels,
        uniqueContacted: byUser(contacted)[m.id] || 0,
        conversations: byUser(conversations)[m.id] || 0,
        replies: byUser(replies)[m.id] || 0,
        followUpsDone: byUser(followUps)[m.id] || 0,
        overdueNow: byUser(overdue)[m.id] || 0,
        meetings: byUser(meetings)[m.id] || 0,
        pricingSent: byUser(pricing)[m.id] || 0,
        paymentsConfirmed: byUser(payments)[m.id] || 0,
        paymentsCents: byUser(payments, 'cents')[m.id] || 0,
        approvedClients: byUser(approved)[m.id] || 0,
      },
      time: time[m.id] || { minutes: 0, manualMinutes: 0, corrected: 0 },
    };
  }).filter((p) => p.does.qualifying || p.does.selling || p.time.minutes || p.qualifier.completed || p.sales.attempts);
  return { from, to, people };
}

const USER_ATTRS = ['id', 'name'];

async function listCredits(ctx, query = {}) {
  const { from, to } = workSessions.range(query);
  const where = { agencyOrganizationId: ctx.agencyId, kind: 'qualification', earnedAt: { [Op.gte]: from, [Op.lte]: to } };
  if (query.userId) where.userId = query.userId;
  if (WorkCredit.STATUSES.includes(query.status)) where.status = query.status;
  const credits = await WorkCredit.findAll({
    where,
    include: [
      { model: User, as: 'user', attributes: USER_ATTRS },
      { model: User, as: 'reviewedBy', attributes: USER_ATTRS },
      {
        model: Opportunity,
        as: 'opportunity',
        attributes: ['id', 'stage', 'qualificationStatus', 'outreachReason', 'assignedToUserId', 'lastInteractionAt', 'paymentConfirmedAt', 'qualifiedAt'],
        include: [{ model: Organization, as: 'organization', attributes: ['name', 'city', 'state'] }, { model: User, as: 'assignedTo', attributes: USER_ATTRS }],
      },
    ],
    order: [['earnedAt', 'DESC']],
    limit: 1000,
  });
  return {
    items: credits.map((c) => ({
      id: c.id,
      status: c.status,
      earnedAt: c.earnedAt,
      user: c.user,
      reviewNote: c.reviewNote,
      reviewedBy: c.reviewedBy,
      reviewedAt: c.reviewedAt,
      paidAt: c.paidAt,
      correctionCount: c.correctionCount,
      lastCorrectionReason: c.lastCorrectionReason,
      opportunityId: c.opportunityId,
      businessName: c.opportunity?.organization?.name,
      location: [c.opportunity?.organization?.city, c.opportunity?.organization?.state].filter(Boolean).join(', '),
      reason: c.opportunity?.outreachReason,
      qualificationLabel: c.opportunity?.qualificationStatus ? QUALIFICATION_LABELS[c.opportunity.qualificationStatus] : null,
      stageLabel: c.opportunity ? STAGE_LABELS[c.opportunity.stage] : null,
      salesperson: c.opportunity?.assignedTo || null,
      contacted: Boolean(c.opportunity?.lastInteractionAt),
      paymentConfirmed: Boolean(c.opportunity?.paymentConfirmedAt),
    })),
    statuses: WorkCredit.STATUSES,
  };
}

const TRANSITIONS = {
  pending: ['accepted', 'needs_correction', 'rejected'],
  accepted: ['paid', 'needs_correction', 'rejected', 'pending'],
  needs_correction: ['accepted', 'rejected', 'pending'],
  rejected: ['pending', 'accepted'],
  paid: [],
};

/**
 * Compensation review of a qualification credit. Separate from the lead's
 * operations: reviewing never moves the lead or pulls it from sales.
 */
async function reviewCredits(ctx, { ids, status, note }) {
  const list = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string').slice(0, 200);
  if (!list.length) throw invalid('Choose at least one record.');
  if (!WorkCredit.STATUSES.includes(status)) throw invalid('Unknown review status');
  const text = String(note || '').trim().slice(0, 500);
  if (['needs_correction', 'rejected'].includes(status) && !text) throw invalid('Add a reason so the qualifier knows what to fix.');
  assertNoSecrets(text, 'Review note');
  const credits = await WorkCredit.findAll({
    where: { id: list, agencyOrganizationId: ctx.agencyId },
    include: [{ model: Opportunity, as: 'opportunity', attributes: ['id'], include: [{ model: Organization, as: 'organization', attributes: ['name'] }] }],
  });
  const skipped = [];
  const updated = [];
  for (const credit of credits) {
    if (credit.status === status) { updated.push(credit.id); continue; }
    if (!TRANSITIONS[credit.status].includes(status)) { skipped.push({ id: credit.id, from: credit.status }); continue; }
    if (credit.userId === ctx.userId && status !== 'pending') { skipped.push({ id: credit.id, reason: 'own work' }); continue; }
    await credit.update({
      status,
      reviewNote: text || credit.reviewNote,
      reviewedByUserId: ctx.userId,
      reviewedAt: new Date(),
      ...(status === 'paid' ? { paidAt: new Date(), paidByUserId: ctx.userId } : {}),
    });
    updated.push(credit.id);
    if (['needs_correction', 'rejected'].includes(status)) {
      await notify({
        userId: credit.userId,
        organizationId: ctx.agencyId,
        type: 'work_review',
        title: `${status === 'rejected' ? 'Not accepted' : 'Needs correction'} — ${credit.opportunity?.organization?.name || 'a qualification'}`,
        body: text,
        data: { opportunityId: credit.opportunityId, link: `/app/qualify/${credit.opportunityId}` },
      }).catch(() => null);
    }
    await recordAudit({
      organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'work_credit.reviewed', targetType: 'WorkCredit', targetId: credit.id, metadata: { status }, req: ctx.req,
    });
  }
  return { updated, skipped };
}

/** The records behind a number, for drill-down. */
async function records(ctx, query = {}) {
  const { from, to } = workSessions.range(query);
  const userId = query.userId;
  if (!userId) throw invalid('Choose a person.');
  const kind = query.kind;
  if (kind === 'activities') {
    const rows = await OutreachActivity.findAll({
      where: {
        organizationId: ctx.agencyId, userId, deletedAt: null, createdAt: { [Op.gte]: from, [Op.lte]: to },
      },
      include: [{ model: Opportunity, as: 'opportunity', attributes: ['id'], include: [{ model: Organization, as: 'organization', attributes: ['name'] }] }],
      order: [['createdAt', 'DESC']],
      limit: 500,
    });
    return {
      items: rows.map((a) => ({
        id: a.id, at: a.occurredAt || a.createdAt, opportunityId: a.opportunityId, businessName: a.opportunity?.organization?.name || null, channel: a.channel || a.type, direction: a.direction, origin: a.origin, status: a.status, outcome: a.outcome ? OUTCOMES[a.outcome]?.label || a.outcome : null, subject: a.subject,
      })),
    };
  }
  if (kind === 'payments') {
    const rows = await SalesPayment.findAll({
      where: {
        agencyOrganizationId: ctx.agencyId, attributedUserId: userId, kind: 'initial', paidAt: { [Op.gte]: from, [Op.lte]: to },
      },
      include: [{ model: Organization, as: 'organization', attributes: ['name'] }],
      order: [['paidAt', 'DESC']],
    });
    return {
      items: rows.map((p) => ({
        id: p.id, at: p.paidAt, opportunityId: p.opportunityId, businessName: p.organization?.name || null, amountCents: p.amountCents, refundedCents: p.amountRefundedCents, currency: p.currency, source: p.source, stripeMode: p.stripeMode,
      })),
    };
  }
  if (kind === 'qualifications') return listCredits(ctx, { ...query, userId });
  if (kind === 'time') return workSessions.list(ctx, { ...query, userId });
  throw invalid('Unknown record type');
}

module.exports = {
  report, listCredits, reviewCredits, records,
};

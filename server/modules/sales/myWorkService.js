'use strict';

const { Op } = require('sequelize');
const {
  Opportunity, Organization, User, WorkCredit, WorkSession, SalesHandoff,
} = require('../../models');
const today = require('./todayService');
const qualification = require('./qualificationService');
const onboarding = require('./onboardingService');
const workSessions = require('./workSessionService');
const { inSalesWhere, STAGE_LABELS } = require('../../core/crm/pipelineCatalog');

/**
 * My Work (ADR 0016): the one home page, built from the caller's own
 * permissions. Each role gets only its own sections — a qualifier never
 * receives revenue, domain or client alerts, and a salesperson gets their
 * queue rather than company dashboards. Someone with several roles gets
 * each section they hold.
 */

const USER_ATTRS = ['id', 'name'];

function rolesFor(ctx) {
  const roles = [];
  if (ctx.can('qualification.work')) roles.push('qualifier');
  if (ctx.can('outreach.send')) roles.push('sales');
  if (ctx.can('clients.onboard')) roles.push('client_manager');
  if (ctx.can('sales.approve_close') || ctx.can('team.review_work')) roles.push('admin');
  return roles;
}

function weekStart() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - day * 86400000);
}

async function qualifierSection(ctx) {
  const research = await qualification.myResearch(ctx);
  const since = weekStart();
  const [startedThisWeek, credits, feedback] = await Promise.all([
    Opportunity.count({ where: { agencyOrganizationId: ctx.agencyId, researcherUserId: ctx.userId, createdAt: { [Op.gte]: since } } }),
    WorkCredit.findAll({ where: { agencyOrganizationId: ctx.agencyId, userId: ctx.userId, kind: 'qualification' }, attributes: ['status', 'earnedAt'] }),
    WorkCredit.findAll({
      where: {
        agencyOrganizationId: ctx.agencyId, userId: ctx.userId, status: ['needs_correction', 'rejected'], reviewedAt: { [Op.ne]: null },
      },
      include: [{ model: Opportunity, as: 'opportunity', attributes: ['id'], include: [{ model: Organization, as: 'organization', attributes: ['name'] }] }],
      order: [['reviewedAt', 'DESC']],
      limit: 10,
    }),
  ]);
  const count = (fn) => credits.filter(fn).length;
  return {
    ...research,
    feedback: feedback.map((c) => ({
      opportunityId: c.opportunityId, businessName: c.opportunity?.organization?.name, status: c.status, note: c.reviewNote, reviewedAt: c.reviewedAt,
    })),
    stats: {
      startedThisWeek,
      completedThisWeek: count((c) => new Date(c.earnedAt) >= since),
      completedTotal: credits.length,
      pendingReview: count((c) => c.status === 'pending'),
      accepted: count((c) => ['accepted', 'paid'].includes(c.status)),
    },
  };
}

async function salesSection(ctx, query) {
  const t = await today.getToday(ctx, { scope: 'mine', tzOffset: query.tzOffset });
  const include = [{ model: Organization, as: 'organization', attributes: ['id', 'name', 'city', 'state'] }];
  const base = {
    agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, assignedToUserId: ctx.userId, [Op.and]: [inSalesWhere()],
  };
  const [meetings, closing, qualifiedNew] = await Promise.all([
    Opportunity.findAll({
      where: { ...base, stage: { [Op.notIn]: ['won', 'lost'] }, meeting: { status: { [Op.in]: ['scheduled', 'rescheduled'] } } },
      include,
      order: [['nextActionAt', 'ASC']],
      limit: 20,
    }),
    Opportunity.findAll({
      where: {
        ...base,
        stage: { [Op.notIn]: ['won', 'lost'] },
        [Op.or]: [{ closingStatus: ['returned', 'submitted'] }, { paymentConfirmedAt: { [Op.ne]: null }, closingStatus: null }],
      },
      include,
      order: [['updatedAt', 'DESC']],
      limit: 20,
    }),
    Opportunity.findAll({
      where: {
        ...base, qualificationStatus: 'assigned', lastInteractionAt: null, stage: 'new',
      },
      include: [...include, { model: User, as: 'qualifiedBy', attributes: USER_ATTRS }],
      order: [['qualifiedAt', 'DESC']],
      limit: 25,
    }),
  ]);
  const card = (o, extra = {}) => ({
    opportunityId: o.id, businessName: o.organization?.name, city: o.organization?.city, state: o.organization?.state, stageLabel: STAGE_LABELS[o.stage], ...extra,
  });
  return {
    replies: t.replies,
    overdue: t.overdue,
    dueToday: t.dueToday,
    payments: t.payments,
    stalled: t.stalled,
    // Leads added by sales directly (not through qualification) that haven't been contacted.
    newLeads: t.newLeads.filter((l) => !qualifiedNew.some((o) => o.id === l.opportunityId)),
    newlyAssigned: qualifiedNew.map((o) => card(o, { qualifiedBy: o.qualifiedBy, reason: o.outreachReason, qualifiedAt: o.qualifiedAt })),
    meetings: meetings.map((o) => card(o, { at: o.meeting?.at, method: o.meeting?.methodLabel })),
    closing: closing.map((o) => card(o, {
      closingStatus: o.closingStatus, paymentConfirmedAt: o.paymentConfirmedAt, reviewNote: o.closingReviewNote,
    })),
    goals: t.goals,
    queueSize: t.queueSize,
    unclaimed: t.unclaimed,
  };
}

async function adminSection(ctx) {
  const [closings, ready, pendingCredits, abandoned, failedHandoffs] = await Promise.all([
    ctx.can('sales.approve_close') ? Opportunity.count({ where: { agencyOrganizationId: ctx.agencyId, deletedAt: null, closingStatus: 'submitted' } }) : 0,
    Opportunity.count({
      where: {
        agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, qualificationStatus: 'ready',
      },
    }),
    ctx.can('team.review_work') ? WorkCredit.count({ where: { agencyOrganizationId: ctx.agencyId, status: 'pending' } }) : 0,
    ctx.can('team.review_work') ? WorkSession.count({ where: { agencyOrganizationId: ctx.agencyId, status: 'abandoned' } }) : 0,
    SalesHandoff.count({ where: { agencyOrganizationId: ctx.agencyId, status: 'failed' } }),
  ]);
  return {
    closingsToApprove: closings, readyForAssignment: ready, creditsToReview: pendingCredits, abandonedTimers: abandoned, failedHandoffs,
  };
}

async function getMyWork(ctx, query = {}) {
  const roles = rolesFor(ctx);
  const [qualifier, sales, clientManager, admin, timer] = await Promise.all([
    roles.includes('qualifier') ? qualifierSection(ctx) : null,
    roles.includes('sales') ? salesSection(ctx, query) : null,
    roles.includes('client_manager') ? onboarding.listForMe(ctx) : null,
    roles.includes('admin') ? adminSection(ctx) : null,
    workSessions.current(ctx),
  ]);
  return {
    roles, qualifier, sales, clientManager, admin, timer,
  };
}

module.exports = { getMyWork, rolesFor };

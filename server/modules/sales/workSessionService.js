'use strict';

const { Op } = require('sequelize');
const {
  WorkSession, Opportunity, Organization, User,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { invalid, isUniqueViolation, assertNoSecrets } = require('./salesCommon');

/**
 * Employee-recorded work time (ADR 0016). A person starts, pauses and stops
 * their own timer, or adds time worked outside the app with a note. Nothing
 * is inferred from activity or an open tab. A timer left open for longer
 * than a working day becomes "abandoned" and counts as zero until the
 * person corrects it with a reason; every correction keeps the original.
 */

const ABANDON_AFTER_MS = 12 * 3600 * 1000;
const MAX_MANUAL_MINUTES = 12 * 60;
const OPEN = ['running', 'paused'];

function elapsedMinutes(session, end = new Date()) {
  const paused = session.pausedSeconds + (session.pausedAt ? Math.max(0, (end - new Date(session.pausedAt)) / 1000) : 0);
  return Math.max(0, Math.round(((end - new Date(session.startedAt)) / 1000 - paused) / 60));
}

function present(session) {
  const json = session.toJSON ? session.toJSON() : session;
  return {
    id: json.id,
    workType: json.workType,
    source: json.source,
    status: json.status,
    startedAt: json.startedAt,
    endedAt: json.endedAt,
    pausedAt: json.pausedAt,
    pausedSeconds: json.pausedSeconds,
    minutes: OPEN.includes(json.status) ? elapsedMinutes(json) : json.minutes,
    note: json.note,
    originalMinutes: json.originalMinutes,
    correctionReason: json.correctionReason,
    correctedAt: json.correctedAt,
    reviewStatus: json.reviewStatus,
    opportunityId: json.opportunityId,
    businessName: json.opportunity?.organization?.name || null,
    user: json.user ? { id: json.user.id, name: json.user.name } : null,
  };
}

const INCLUDE = [
  { model: Opportunity, as: 'opportunity', attributes: ['id'], include: [{ model: Organization, as: 'organization', attributes: ['name'] }] },
  { model: User, as: 'user', attributes: ['id', 'name'] },
];

/** Closes a timer left open too long: it counts as nothing until corrected. */
async function sweepAbandoned(ctx, userId) {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS);
  const stale = await WorkSession.findAll({
    where: {
      agencyOrganizationId: ctx.agencyId, userId, status: OPEN, startedAt: { [Op.lt]: cutoff },
    },
  });
  for (const session of stale) {
    await session.update({ status: 'abandoned', endedAt: null, pausedAt: null, minutes: 0 });
  }
}

async function current(ctx) {
  await sweepAbandoned(ctx, ctx.userId);
  const session = await WorkSession.findOne({ where: { agencyOrganizationId: ctx.agencyId, userId: ctx.userId, status: OPEN }, include: INCLUDE });
  const abandoned = await WorkSession.count({ where: { agencyOrganizationId: ctx.agencyId, userId: ctx.userId, status: 'abandoned' } });
  return { session: session ? present(session) : null, abandoned, workTypes: WorkSession.WORK_TYPES };
}

async function opportunityFor(ctx, opportunityId) {
  if (!opportunityId) return null;
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null }, attributes: ['id'] });
  if (!opportunity) throw invalid('Lead not found', 404);
  return opportunity.id;
}

async function start(ctx, { workType, opportunityId }) {
  if (!WorkSession.WORK_TYPES.includes(workType)) throw invalid('Choose the kind of work.');
  await sweepAbandoned(ctx, ctx.userId);
  const open = await WorkSession.findOne({ where: { agencyOrganizationId: ctx.agencyId, userId: ctx.userId, status: OPEN } });
  if (open) throw invalid('A timer is already running. Stop it before starting another.', 409);
  try {
    await WorkSession.create({
      agencyOrganizationId: ctx.agencyId, userId: ctx.userId, opportunityId: await opportunityFor(ctx, opportunityId), workType, source: 'timer', status: 'running', startedAt: new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw invalid('A timer is already running. Stop it before starting another.', 409);
    throw err;
  }
  return current(ctx);
}

async function loadOwnOpen(ctx) {
  const session = await WorkSession.findOne({ where: { agencyOrganizationId: ctx.agencyId, userId: ctx.userId, status: OPEN } });
  if (!session) throw invalid('No timer is running.', 409);
  return session;
}

async function pause(ctx) {
  const session = await loadOwnOpen(ctx);
  if (session.status === 'running') await session.update({ status: 'paused', pausedAt: new Date() });
  return current(ctx);
}

async function resume(ctx) {
  const session = await loadOwnOpen(ctx);
  if (session.status === 'paused') {
    const pausedFor = Math.round((Date.now() - new Date(session.pausedAt).getTime()) / 1000);
    await session.update({ status: 'running', pausedAt: null, pausedSeconds: session.pausedSeconds + pausedFor });
  }
  return current(ctx);
}

async function stop(ctx, { note }) {
  const session = await loadOwnOpen(ctx);
  const text = note ? String(note).trim().slice(0, 1000) : null;
  assertNoSecrets(text, 'Note');
  const end = new Date();
  await session.update({
    status: 'stopped', endedAt: end, minutes: elapsedMinutes(session, end), pausedAt: null, note: text || session.note,
  });
  return current(ctx);
}

/** Time worked outside the app (e.g. research or calls on a phone), with a note. */
async function addManual(ctx, input) {
  if (!WorkSession.WORK_TYPES.includes(input.workType)) throw invalid('Choose the kind of work.');
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MANUAL_MINUTES) throw invalid('Enter whole minutes, up to 12 hours.');
  const startedAt = new Date(input.startedAt);
  if (Number.isNaN(startedAt.getTime()) || startedAt > new Date()) throw invalid('Enter when you started (not in the future).');
  const note = String(input.note || '').trim().slice(0, 1000);
  if (!note) throw invalid('Add a short note about what you worked on.');
  assertNoSecrets(note, 'Note');
  const endedAt = new Date(startedAt.getTime() + minutes * 60000);
  const overlap = await WorkSession.findOne({
    where: {
      agencyOrganizationId: ctx.agencyId,
      userId: ctx.userId,
      status: { [Op.in]: ['stopped', 'running', 'paused'] },
      startedAt: { [Op.lt]: endedAt },
      [Op.or]: [{ endedAt: { [Op.gt]: startedAt } }, { endedAt: null }],
    },
  });
  if (overlap) throw invalid('That time overlaps time you already recorded.', 409);
  await WorkSession.create({
    agencyOrganizationId: ctx.agencyId,
    userId: ctx.userId,
    opportunityId: await opportunityFor(ctx, input.opportunityId),
    workType: input.workType,
    source: 'manual',
    status: 'stopped',
    startedAt,
    endedAt,
    minutes,
    note,
  });
  return list(ctx, { userId: ctx.userId });
}

/** Changes the minutes on a session with a reason; the original stays on record. */
async function correct(ctx, sessionId, { minutes, reason }) {
  const session = await WorkSession.findOne({ where: { id: sessionId, agencyOrganizationId: ctx.agencyId } });
  if (!session) throw invalid('Time entry not found', 404);
  const admin = ctx.can('team.review_work');
  if (session.userId !== ctx.userId && !admin) throw invalid('You can only correct your own time.', 403);
  if (OPEN.includes(session.status)) throw invalid('Stop the timer first.', 409);
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 0 || value > MAX_MANUAL_MINUTES) throw invalid('Enter whole minutes, up to 12 hours.');
  const text = String(reason || '').trim().slice(0, 500);
  if (!text) throw invalid('Say why the time is being corrected.');
  assertNoSecrets(text, 'Reason');
  await session.update({
    originalMinutes: session.originalMinutes ?? session.minutes ?? 0,
    minutes: value,
    status: 'stopped',
    endedAt: session.endedAt || new Date(new Date(session.startedAt).getTime() + value * 60000),
    correctionReason: text,
    correctedByUserId: ctx.userId,
    correctedAt: new Date(),
    // A correction needs a fresh look from whoever reviews time.
    reviewStatus: 'unreviewed',
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'work_session.corrected', targetType: 'WorkSession', targetId: session.id, metadata: { minutes: value, originalMinutes: session.originalMinutes }, req: ctx.req,
  });
  return present(session);
}

async function review(ctx, sessionId, { reviewStatus }) {
  if (!['approved', 'flagged', 'unreviewed'].includes(reviewStatus)) throw invalid('Unknown review status');
  const session = await WorkSession.findOne({ where: { id: sessionId, agencyOrganizationId: ctx.agencyId } });
  if (!session) throw invalid('Time entry not found', 404);
  await session.update({ reviewStatus, reviewedByUserId: ctx.userId, reviewedAt: new Date() });
  return present(session);
}

function range(query) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw invalid('Choose valid dates.');
  return { from, to };
}

/** Own time, or anyone's for a reviewer. */
async function list(ctx, query = {}) {
  const admin = ctx.can('team.review_work');
  const userId = admin ? (query.userId || null) : ctx.userId;
  const { from, to } = range(query);
  const sessions = await WorkSession.findAll({
    where: {
      agencyOrganizationId: ctx.agencyId, ...(userId ? { userId } : {}), startedAt: { [Op.gte]: from, [Op.lte]: to },
    },
    include: INCLUDE,
    order: [['startedAt', 'DESC']],
    limit: 500,
  });
  const items = sessions.map(present);
  return {
    items,
    totalMinutes: items.filter((s) => s.status === 'stopped').reduce((sum, s) => sum + (s.minutes || 0), 0),
    from,
    to,
  };
}

/** Recorded minutes per user in a range (stopped sessions only — abandoned count as zero). */
async function minutesByUser(agencyId, from, to) {
  const rows = await WorkSession.findAll({
    where: {
      agencyOrganizationId: agencyId, status: 'stopped', startedAt: { [Op.gte]: from, [Op.lte]: to },
    },
    attributes: ['userId', 'minutes', 'source', 'originalMinutes'],
  });
  const out = {};
  for (const r of rows) {
    out[r.userId] = out[r.userId] || { minutes: 0, manualMinutes: 0, corrected: 0 };
    out[r.userId].minutes += r.minutes || 0;
    if (r.source === 'manual') out[r.userId].manualMinutes += r.minutes || 0;
    if (r.originalMinutes !== null && r.originalMinutes !== undefined) out[r.userId].corrected += 1;
  }
  return out;
}

module.exports = {
  current, start, pause, resume, stop, addManual, correct, review, list, minutesByUser, range,
};

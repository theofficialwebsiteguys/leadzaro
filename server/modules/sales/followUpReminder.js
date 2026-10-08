'use strict';

const { Op, QueryTypes } = require('sequelize');
const {
  sequelize, Notification, NotificationPreference, Organization, OrganizationMembership,
} = require('../../models');
const { effectiveOffset } = require('../../core/workspace/timezone');

/**
 * The daily follow-up reminder (ADR 0013). Once a day, from 7am in the
 * workspace's timezone (UTC when none is set), each salesperson with
 * replies waiting or follow-ups due or overdue gets one in-app
 * notification that opens Today. It only reminds the team — nothing is
 * ever sent to a lead — and it is never emailed. A reminder already
 * created today is never repeated, so restarts and hourly ticks are safe.
 */

const REMIND_FROM_HOUR = 7;
const OPEN_STAGES = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'nurture'];

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

async function remindAgency(agencyId, timezone, now) {
  const offset = effectiveOffset(timezone || null, 0);
  const local = new Date(now.getTime() - offset * 60000);
  if (local.getUTCHours() < REMIND_FROM_HOUR) return 0;
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offset * 60000);
  const end = new Date(start.getTime() + 86400000);

  const rows = await sequelize.query(`SELECT o."assignedToUserId" AS "userId",
      COUNT(*) FILTER (WHERE o."replyNeededSince" IS NOT NULL)::int AS replies,
      COUNT(*) FILTER (WHERE o."replyNeededSince" IS NULL AND o."nextActionAt" < :start)::int AS overdue,
      COUNT(*) FILTER (WHERE o."replyNeededSince" IS NULL AND o."nextActionAt" >= :start AND o."nextActionAt" < :end)::int AS "dueToday"
    FROM "Opportunities" o
    WHERE o."agencyOrganizationId" = :agencyId AND o."deletedAt" IS NULL AND o."archivedAt" IS NULL AND o."doNotContact" = false
      AND o."isTest" = false AND o."assignedToUserId" IS NOT NULL AND o.stage IN (:open)
    GROUP BY 1`, {
    replacements: {
      agencyId, start, end, open: OPEN_STAGES,
    },
    type: QueryTypes.SELECT,
  });
  const due = rows.filter((row) => row.replies || row.overdue || row.dueToday);
  if (!due.length) return 0;

  const userIds = due.map((row) => row.userId);
  const [members, muted, alreadySent] = await Promise.all([
    OrganizationMembership.findAll({
      where: {
        organizationId: agencyId, userId: userIds, membershipType: 'employee', status: 'active', deletedAt: null,
      },
      attributes: ['userId'],
    }),
    NotificationPreference.findAll({
      where: {
        userId: userIds, category: 'follow_up_due', channel: 'in_app', frequency: 'muted',
      },
      attributes: ['userId'],
    }),
    Notification.findAll({
      where: { userId: userIds, type: 'follow_up_due', createdAt: { [Op.gte]: start } },
      attributes: ['userId'],
    }),
  ]);
  const active = new Set(members.map((m) => m.userId));
  const skip = new Set([...muted.map((m) => m.userId), ...alreadySent.map((n) => n.userId)]);

  const notifications = due.filter((row) => active.has(row.userId) && !skip.has(row.userId)).map((row) => {
    const parts = [];
    if (row.replies) parts.push(`${plural(row.replies, 'reply', 'replies')} waiting on you`);
    if (row.overdue) parts.push(`${row.overdue} overdue`);
    if (row.dueToday) parts.push(`${row.dueToday} due today`);
    const total = row.replies + row.overdue + row.dueToday;
    return {
      userId: row.userId,
      organizationId: agencyId,
      type: 'follow_up_due',
      title: `${plural(total, 'lead needs', 'leads need')} you today`,
      body: `${parts.join(' · ')}. Open Today to work through them.`,
      data: {
        link: '/app/today', replies: row.replies, overdue: row.overdue, dueToday: row.dueToday,
      },
    };
  });
  if (notifications.length) await Notification.bulkCreate(notifications);
  return notifications.length;
}

async function remindFollowUps(now = new Date()) {
  const agencies = await sequelize.query(`SELECT DISTINCT o."agencyOrganizationId" AS id FROM "Opportunities" o
    WHERE o."deletedAt" IS NULL AND o."archivedAt" IS NULL AND o."assignedToUserId" IS NOT NULL AND o.stage IN (:open)`, {
    replacements: { open: OPEN_STAGES },
    type: QueryTypes.SELECT,
  });
  let sent = 0;
  for (const { id } of agencies) {
    // eslint-disable-next-line no-await-in-loop
    const agency = await Organization.findByPk(id, { attributes: ['id', 'settings'] });
    // eslint-disable-next-line no-await-in-loop
    if (agency) sent += await remindAgency(agency.id, agency.settings?.timezone, now);
  }
  return sent;
}

module.exports = { remindFollowUps };

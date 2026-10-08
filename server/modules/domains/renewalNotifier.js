'use strict';

const { Op } = require('sequelize');
const { Notification, NotificationPreference, OrganizationMembership } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const { domainFacts, daysUntil, toDateOnly } = require('../../core/domains/domainFacts');

/**
 * In-app renewal reminders for the agency team (ADR 0009) — no email and
 * never anything to clients. At most one digest per team member per run,
 * and each domain/plan is announced once per threshold (30 days, 7 days,
 * expired) for a given expiration date; a renewal that moves the date
 * starts the thresholds over. Auto-renew never suppresses a reminder: it
 * is a setting, not proof that the renewal went through.
 */

const RANK = { 30: 1, 7: 2, expired: 3 };

function levelFor(days) {
  if (days === null || days === undefined) return null;
  if (days < 0) return 'expired';
  if (days <= 7) return '7';
  if (days <= 30) return '30';
  return null;
}

function alreadyNotified(item, level, expiresOn) {
  return item.expiryNoticeForDate && toDateOnly(item.expiryNoticeForDate) === expiresOn && RANK[item.expiryNoticeLevel] >= RANK[level];
}

function autoRenewPhrase(autoRenew) {
  if (autoRenew === true) return 'auto-renew is on — confirm the renewal goes through';
  if (autoRenew === false) return 'auto-renew is off';
  return 'auto-renew unknown';
}

function whenPhrase(days) {
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'expires today';
  return `expires in ${days} day${days === 1 ? '' : 's'}`;
}

async function dueItems(agencyOrganizationId, now) {
  const items = [];
  const records = await access.domainRecords.findAll(agencyOrganizationId, {});
  for (const record of records) {
    const facts = domainFacts(record, null, now);
    const expiresOn = facts.expiresOn.value;
    const level = levelFor(facts.daysUntilExpiry);
    if (!level || alreadyNotified(record, level, expiresOn)) continue;
    items.push({
      row: record, level, expiresOn, name: facts.displayName, days: facts.daysUntilExpiry, autoRenew: facts.autoRenew.value, kind: 'domain',
    });
  }
  const plans = await access.hostingPlans.findAll(agencyOrganizationId, { where: { archivedAt: null, expiresOn: { [Op.ne]: null } } });
  for (const plan of plans) {
    const expiresOn = toDateOnly(plan.expiresOn);
    const days = daysUntil(expiresOn, now);
    const level = levelFor(days);
    if (!level || alreadyNotified(plan, level, expiresOn)) continue;
    items.push({
      row: plan, level, expiresOn, name: `${plan.name} (hosting)`, days, autoRenew: plan.autoRenew, kind: 'hosting',
    });
  }
  return items.sort((a, b) => a.days - b.days);
}

async function notifyUpcomingRenewals(agencyOrganizationId, now = new Date()) {
  const items = await dueItems(agencyOrganizationId, now);
  if (!items.length) return { notified: 0, items: 0 };

  const members = await OrganizationMembership.findAll({
    where: {
      organizationId: agencyOrganizationId, status: 'active', membershipType: 'employee', deletedAt: null,
    },
    attributes: ['userId'],
  });
  const title = items.length === 1
    ? `${items[0].name} ${whenPhrase(items[0].days)}`
    : `${items.length} renewals need attention`;
  const body = items.slice(0, 10).map((item) => `${item.name} — ${whenPhrase(item.days)} (${autoRenewPhrase(item.autoRenew)})`).join('\n')
    + (items.length > 10 ? `\n…and ${items.length - 10} more` : '');
  const data = {
    link: '/app/domains',
    items: items.map((item) => ({
      kind: item.kind, name: item.name, expiresOn: item.expiresOn, daysUntilExpiry: item.days,
    })),
  };
  // People who switched renewal reminders off in Settings → Notifications (ADR 0012).
  const mutedRows = await NotificationPreference.findAll({
    where: { category: 'renewal_upcoming', channel: 'in_app', frequency: 'muted' }, attributes: ['userId'],
  });
  const mutedIds = new Set(mutedRows.map((row) => row.userId));
  const userIds = [...new Set(members.map((member) => member.userId))].filter((id) => !mutedIds.has(id));
  if (userIds.length) {
    await Notification.bulkCreate(userIds.map((userId) => ({
      userId, organizationId: agencyOrganizationId, type: 'renewal_upcoming', title, body, data,
    })));
  }
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await item.row.update({ expiryNoticeLevel: item.level, expiryNoticeForDate: item.expiresOn });
  }
  return { notified: userIds.length, items: items.length };
}

module.exports = { notifyUpcomingRenewals, levelFor };

'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize, User } = require('../../models');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');

/**
 * Client account health (ADR 0013): for any set of clients, in a fixed
 * number of queries, everything that says whether an account needs
 * someone — billing problems, unfinished onboarding, who it is waiting on,
 * an overdue next action, overdue tasks — and what information is still
 * missing. The Clients list, a client's page, the Dashboard and Reports
 * all read from here, so they always agree.
 *
 * Every query is pinned to the agency; guarded models (ClientProfile,
 * Task, ClientNote) are read raw here only after the caller resolved the
 * client organizations through the client-hub tenant check.
 */

const PROBLEM_SUBSCRIPTION = ['past_due', 'unpaid', 'incomplete'];
const LIVE_SUBSCRIPTION = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete'];
const OPEN_HANDOFF = ['pending', 'needs_info', 'failed'];
const WAITING_ON_CLIENT_ALERT_DAYS = 14;

const FILTERS = {
  attention: 'Needs attention',
  mine: 'My clients',
  waiting_us: 'Waiting on us',
  waiting_client: 'Waiting on client',
  onboarding: 'Onboarding',
  billing: 'Billing issues',
  next_overdue: 'Next action overdue',
  tasks_overdue: 'Overdue tasks',
  missing_info: 'Missing information',
  unassigned: 'No client manager',
};

const MISSING_LABELS = {
  contact: 'Contact with email or phone',
  website: 'Website',
  services: 'Services',
  manager: 'Client manager',
  billing: 'Billing details',
};

async function q(sql, replacements) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

/** Today's date (YYYY-MM-DD) in the workspace, from an offset in Date#getTimezoneOffset convention. */
function localDateKey(offsetMinutes = 0, at = new Date()) {
  return new Date(at.getTime() - offsetMinutes * 60000).toISOString().slice(0, 10);
}

function shortDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(value));
}

function daysSince(date, now = new Date()) {
  if (!date) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / 86400000));
}

/**
 * Loads the raw account facts for the given clients. `profiles`,
 * `contacts` and `projects` come from the caller (already loaded through
 * the tenant-checked accessors); the rest is read here in six queries.
 */
async function loadFacts(agencyId, organizationIds, { profiles = [], contacts = [], projects = [] } = {}) {
  if (!organizationIds.length) return new Map();
  const r = { agencyId, ids: organizationIds, mode: getStripeAdapter().mode };
  const [tasks, subscriptions, handoffs, notes, links, payments] = await Promise.all([
    q(`SELECT t."organizationId",
        COUNT(*) FILTER (WHERE t.status <> 'done')::int AS open,
        COUNT(*) FILTER (WHERE t.status <> 'done' AND t."dueDate" < CURRENT_DATE)::int AS overdue,
        COUNT(*) FILTER (WHERE t.status = 'blocked')::int AS blocked,
        MIN(t."dueDate") FILTER (WHERE t.status <> 'done' AND t."dueDate" IS NOT NULL) AS "nextDue"
      FROM "Tasks" t
      WHERE t."agencyOrganizationId" = :agencyId AND t."organizationId" IN (:ids) AND t."archivedAt" IS NULL
      GROUP BY t."organizationId"`, r),
    q(`SELECT ba."organizationId", s.id, s.status, s."productName", s."amountCents", s.currency, s.interval,
        s."cancelAtPeriodEnd", s."currentPeriodEnd", s."stripeMode", s."updatedAt"
      FROM "Subscriptions" s JOIN "BillingAccounts" ba ON ba.id = s."billingAccountId"
      WHERE ba."organizationId" IN (:ids)`, r),
    q(`SELECT DISTINCT ON (h."clientOrganizationId") h."clientOrganizationId" AS "organizationId", h.status, h."opportunityId",
        h.items, h."lastError", h."createdAt", h."completedAt"
      FROM "SalesHandoffs" h
      WHERE h."agencyOrganizationId" = :agencyId AND h."clientOrganizationId" IN (:ids)
      ORDER BY h."clientOrganizationId", (h.status IN ('pending', 'needs_info', 'failed')) DESC, h."createdAt" DESC`, r),
    q(`SELECT n."organizationId", MAX(n."createdAt") AS "lastNoteAt", COUNT(*)::int AS count
      FROM "ClientNotes" n
      WHERE n."agencyOrganizationId" = :agencyId AND n."organizationId" IN (:ids)
      GROUP BY n."organizationId"`, r),
    q(`SELECT l."organizationId" FROM "StripeCustomerLinks" l
      WHERE l."agencyOrganizationId" = :agencyId AND l."organizationId" IN (:ids) AND l."archivedAt" IS NULL AND l."stripeMode" = :mode
      UNION
      SELECT ba."organizationId" FROM "BillingAccounts" ba WHERE ba."organizationId" IN (:ids) AND ba."stripeCustomerId" IS NOT NULL`, r),
    q(`SELECT DISTINCT ON (p."organizationId") p."organizationId", p."paidAt", p."amountCents", p.currency, p.source, p.status,
        (COALESCE(p."stripeMode", 'live') IN ('test', 'mock')) AS test
      FROM "SalesPayments" p
      WHERE p."agencyOrganizationId" = :agencyId AND p."organizationId" IN (:ids)
      ORDER BY p."organizationId", p."paidAt" DESC`, r),
  ]);

  const byOrg = (rows) => new Map(rows.map((row) => [row.organizationId, row]));
  const taskMap = byOrg(tasks);
  const subsMap = groupBy(subscriptions, 'organizationId');
  const handoffMap = byOrg(handoffs);
  const noteMap = byOrg(notes);
  const linked = new Set(links.map((l) => l.organizationId));
  const paymentMap = byOrg(payments);
  const profileMap = new Map(profiles.map((p) => [p.organizationId, p]));
  const contactMap = groupBy(contacts.map((c) => (c.toJSON ? c.toJSON() : c)), 'organizationId');
  const projectMap = groupBy(projects.map((p) => (p.toJSON ? p.toJSON() : p)), 'organizationId');

  const facts = new Map();
  for (const id of organizationIds) {
    facts.set(id, {
      profile: profileMap.get(id) || null,
      contacts: contactMap.get(id) || [],
      projects: projectMap.get(id) || [],
      tasks: taskMap.get(id) || {
        open: 0, overdue: 0, blocked: 0, nextDue: null,
      },
      subscriptions: subsMap.get(id) || [],
      handoff: handoffMap.get(id) || null,
      notes: noteMap.get(id) || { lastNoteAt: null, count: 0 },
      stripeLinked: linked.has(id),
      lastPayment: paymentMap.get(id) || null,
    });
  }
  return facts;
}

function money(cents, currency) {
  if (cents === null || cents === undefined) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

const INTERVAL_SHORT = { month: 'mo', year: 'yr', week: 'wk', day: 'day' };
const FREQUENCY_SHORT = { monthly: 'mo', quarterly: 'qtr', annually: 'yr' };

function billingSummary(fact, profile) {
  const subs = fact.subscriptions.filter((s) => s.stripeMode !== 'mock');
  const problem = subs.find((s) => PROBLEM_SUBSCRIPTION.includes(s.status));
  if (problem) {
    return {
      state: 'problem', label: problem.status === 'past_due' ? 'Past due' : problem.status === 'unpaid' ? 'Unpaid' : 'Payment incomplete', source: 'stripe',
    };
  }
  if (profile?.paymentStatus === 'overdue') return { state: 'problem', label: 'Payment overdue', source: 'manual' };
  const live = subs.filter((s) => ['active', 'trialing'].includes(s.status));
  if (live.length) {
    const cents = live.reduce((sum, s) => sum + (s.amountCents || 0), 0);
    const first = live[0];
    const cancelling = live.find((s) => s.cancelAtPeriodEnd);
    return {
      state: cancelling ? 'cancelling' : 'subscribed',
      label: cents ? `${money(cents, first.currency)}/${INTERVAL_SHORT[first.interval] || first.interval || 'mo'}` : 'Subscribed',
      source: 'stripe',
      test: live.every((s) => s.stripeMode === 'test'),
      cancelsAt: cancelling ? cancelling.currentPeriodEnd : null,
    };
  }
  if (profile?.recurringPriceCents) {
    const per = FREQUENCY_SHORT[profile.billingFrequency];
    return { state: 'manual', label: `${money(profile.recurringPriceCents)}${per ? `/${per}` : ''}`, source: 'manual', paymentStatus: profile.paymentStatus || null };
  }
  if (profile?.paymentStatus && ['paused', 'cancelled'].includes(profile.paymentStatus)) {
    return { state: 'inactive', label: profile.paymentStatus === 'paused' ? 'Billing paused' : 'Billing cancelled', source: 'manual' };
  }
  if (fact.lastPayment) return { state: 'paid', label: `Paid ${money(fact.lastPayment.amountCents, fact.lastPayment.currency)}`, source: fact.lastPayment.source };
  return { state: 'none', label: 'No billing info', source: null };
}

/**
 * Turns facts into flags, plain-language reasons and missing information.
 * `todayKey` is the workspace's local date (YYYY-MM-DD).
 */
function assess(fact, { todayKey, now = new Date() } = {}) {
  const profile = fact.profile || {};
  const flags = new Set();
  const reasons = [];
  const add = (flag, severity, text) => {
    flags.add(flag);
    reasons.push({ flag, severity, text });
  };

  const billing = billingSummary(fact, profile);
  for (const s of fact.subscriptions) {
    if (s.stripeMode === 'mock') continue;
    if (PROBLEM_SUBSCRIPTION.includes(s.status)) add('billing', 'high', `${s.productName || 'Their plan'} — Stripe couldn’t collect the latest invoice.`);
    else if (s.cancelAtPeriodEnd && ['active', 'trialing'].includes(s.status)) {
      add('billing', 'medium', `${s.productName || 'Their plan'} is set to cancel${s.currentPeriodEnd ? ` on ${shortDate(s.currentPeriodEnd)}` : ''}.`);
    }
  }
  if (profile.paymentStatus === 'overdue') add('billing', 'high', 'Marked as payment overdue.');

  const handoff = fact.handoff;
  let onboarding = null;
  if (handoff) {
    const missingEssential = (handoff.items || []).filter((i) => i.essential && !i.done).length;
    onboarding = {
      status: handoff.status, opportunityId: handoff.opportunityId, missingEssential, completedAt: handoff.completedAt,
    };
    if (handoff.status === 'failed') add('onboarding', 'high', 'Payment received but setting up the client failed — retry the handoff.');
    else if (OPEN_HANDOFF.includes(handoff.status)) {
      add('onboarding', 'medium', missingEssential ? `Handoff not finished — ${missingEssential} essential detail${missingEssential === 1 ? '' : 's'} missing.` : 'Handoff ready to be marked complete.');
    }
  }

  if (profile.waitingOn === 'us') {
    add('waiting_us', 'high', `Waiting on us${profile.waitingOnNote ? `: ${profile.waitingOnNote}` : ''}${profile.waitingOnSince ? ` (${daysSince(profile.waitingOnSince, now)}d)` : ''}.`);
  } else if (profile.waitingOn === 'client') {
    flags.add('waiting_client');
    const days = daysSince(profile.waitingOnSince, now);
    if (days !== null && days >= WAITING_ON_CLIENT_ALERT_DAYS) {
      reasons.push({ flag: 'waiting_client', severity: 'medium', text: `Waiting on the client for ${days} days${profile.waitingOnNote ? ` (${profile.waitingOnNote})` : ''} — follow up.` });
    }
  }

  const nextKey = profile.nextActionAt ? new Date(profile.nextActionAt).toISOString().slice(0, 10) : null;
  if (nextKey && todayKey && nextKey < todayKey) add('next_overdue', 'medium', `Next action was due ${shortDate(`${nextKey}T12:00:00Z`)}${profile.nextActionNote ? `: ${profile.nextActionNote}` : ''}.`);

  if (fact.tasks.overdue > 0) add('tasks_overdue', 'medium', `${fact.tasks.overdue} overdue task${fact.tasks.overdue === 1 ? '' : 's'}.`);

  if (!profile.accountManagerUserId) flags.add('unassigned');

  const missing = [];
  if (!fact.contacts.some((c) => c.email || c.phone)) missing.push('contact');
  const hasWebsite = Boolean(profile.websiteUrl || fact.projects.some((p) => p.liveUrl));
  if (!hasWebsite) missing.push('website');
  if (!(profile.services || []).length) missing.push('services');
  if (!profile.accountManagerUserId) missing.push('manager');
  if (billing.state === 'none' && !fact.stripeLinked) missing.push('billing');
  if (missing.length) flags.add('missing_info');

  const neededFromClient = fact.projects.reduce((sum, p) => sum + (p.outstandingNeeds || []).filter((n) => !n.done).length, 0);
  if (reasons.length) flags.add('attention');

  const rank = { high: 0, medium: 1, low: 2 };
  reasons.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return {
    flags: [...flags],
    reasons,
    missing: missing.map((key) => ({ key, label: MISSING_LABELS[key] })),
    billing,
    onboarding,
    tasks: fact.tasks,
    neededFromClient,
    lastNoteAt: fact.notes.lastNoteAt,
    notesCount: fact.notes.count,
    stripeLinked: fact.stripeLinked,
    lastPayment: fact.lastPayment,
    severity: reasons.length ? reasons[0].severity : null,
  };
}

/** Names for the account managers referenced by these profiles. */
async function managerNames(profiles) {
  const ids = [...new Set(profiles.map((p) => p.accountManagerUserId).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.findAll({ where: { id: ids }, attributes: ['id', 'name'] });
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name }]));
}

module.exports = {
  FILTERS, MISSING_LABELS, loadFacts, assess, managerNames, localDateKey, daysSince, PROBLEM_SUBSCRIPTION, LIVE_SUBSCRIPTION,
};

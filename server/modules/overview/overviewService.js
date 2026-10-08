'use strict';

const { Op, QueryTypes } = require('sequelize');
const {
  sequelize, Opportunity, Organization, User, PaymentLinkRequest, SalesHandoff, SalesPayment, OutreachActivity, ConversionAttempt, OrganizationMembership,
} = require('../../models');
const { STAGE_LABELS } = require('../../core/crm/pipelineCatalog');
const { effectiveOffset, startOfLocalDate } = require('../../core/workspace/timezone');
const { dayBounds } = require('../sales/todayService');
const stripeService = require('../sales/stripeService');
const channelService = require('../sales/channelService');
const renewalService = require('../domains/renewalService');
const namecheapConnectionService = require('../integrations/namecheapConnectionService');
const { clientBase } = require('../clients/clientStats');
const { localDateKey } = require('../clients/clientHealth');

/**
 * The Dashboard overview (ADR 0012). A business summary built only from
 * data Leadzaro already stores — the same payments, stages, handoffs,
 * clients and domain facts that Sales, Reports, Clients and Domains use —
 * so the numbers can never disagree. Nothing here calls Stripe or
 * Namecheap live (their status comes from cached/stored state).
 *
 * Scope is decided on the server: "team" needs sales.view_team; anyone
 * else always gets "mine".
 */

const PERIODS = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', month: 'This month' };
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const OPEN_STAGES = ['new', 'contacting', 'qualified', 'proposal', 'awaiting_payment', 'nurture'];

function periodRange(key, offset) {
  const { start } = dayBounds(offset);
  const now = new Date();
  if (key === 'month') {
    const local = new Date(now.getTime() - offset * 60000);
    const first = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-01`;
    return { from: startOfLocalDate(first, offset), to: now };
  }
  const days = Number(key);
  return { from: new Date(start.getTime() - (days - 1) * 86400000), to: now };
}

async function q(sql, replacements) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

function sumByCurrency(rows) {
  return rows.map((r) => ({ currency: r.currency, amountCents: Number(r.amount || 0) }));
}

// ---------------------------------------------------------------- metrics

async function metrics(ctx, {
  team, from, to, stripe, base,
}) {
  const r = {
    agencyId: ctx.agencyId, userId: ctx.userId, from, to,
  };
  const mine = team ? '' : 'AND p."attributedUserId" = :userId';
  const real = `AND COALESCE(p."stripeMode", 'live') NOT IN ('test', 'mock') AND COALESCE(o."isTest", false) = false`;
  const out = [];
  const canSales = ctx.can('leads.read');

  const [anyPayments] = await q(`SELECT COUNT(*)::int AS n FROM "SalesPayments" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
    WHERE p."agencyOrganizationId" = :agencyId ${real}`, r);
  const paymentsUnavailable = !stripe.connected && anyPayments.n === 0;

  if (canSales) {
    const collected = await q(`SELECT p.currency, SUM(p."amountCents" - p."amountRefundedCents")::bigint AS amount,
        SUM(CASE WHEN p.kind = 'initial' THEN p."amountCents" - p."amountRefundedCents" ELSE 0 END)::bigint AS "newAmount"
      FROM "SalesPayments" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
      WHERE p."agencyOrganizationId" = :agencyId AND p."paidAt" >= :from AND p."paidAt" <= :to ${real} ${mine} GROUP BY 1`, r);
    const sales = await q(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE p.source = 'manual')::int AS manual
      FROM "SalesPayments" p LEFT JOIN "Opportunities" o ON o.id = p."opportunityId"
      WHERE p."agencyOrganizationId" = :agencyId AND p.kind = 'initial' AND p."paidAt" >= :from AND p."paidAt" <= :to ${real} ${mine}`, r);
    const renewals = collected.reduce((s, row) => s + Number(row.amount) - Number(row.newAmount), 0);
    out.push({
      key: 'collected',
      label: team ? 'Collected' : 'My collected sales',
      timeframe: 'period',
      format: 'money',
      value: sumByCurrency(collected),
      state: paymentsUnavailable ? 'not_connected' : 'ok',
      note: paymentsUnavailable
        ? 'Stripe isn’t connected and no payments have been recorded.'
        : `Money received, less refunds.${team && renewals ? ' Includes renewals.' : ''} Excludes test payments.`,
      link: { path: '/app/sales/reports', query: team ? { scope: 'team' } : {} },
    });
    out.push({
      key: 'paid_sales',
      label: team ? 'New paid sales' : 'My paid sales',
      timeframe: 'period',
      format: 'count',
      value: sales[0].total,
      state: paymentsUnavailable ? 'not_connected' : 'ok',
      note: paymentsUnavailable ? 'Connect Stripe or record a manual payment to track sales.' : `First payments only${sales[0].manual ? ` · ${sales[0].manual} recorded manually` : ''}. Deals marked won without a payment aren’t counted.`,
      link: { path: '/app/sales/reports', query: team ? { scope: 'team' } : {} },
    });
  }

  if (team && base) {
    out.push({
      key: 'active_clients',
      label: 'Active clients',
      timeframe: 'now',
      format: 'count',
      value: base.active,
      state: 'ok',
      note: `${base.active} of your goal of ${base.goal.target}. ${base.newInPeriod} new in this period${base.endedInPeriod ? `, ${base.endedInPeriod} ended` : ''}. Excludes test clients.`,
      link: { path: '/app/clients', query: {} },
    });
  } else if (canSales) {
    const [open] = await q(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE stage = 'awaiting_payment')::int AS awaiting FROM "Opportunities"
      WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "archivedAt" IS NULL AND "doNotContact" = false AND "isTest" = false
      AND stage IN (:open) AND "assignedToUserId" = :userId`, { ...r, open: OPEN_STAGES });
    out.push({
      key: 'open_deals', label: 'My open deals', timeframe: 'now', format: 'count', value: open.n, state: 'ok', note: `${open.awaiting} awaiting payment. Deal value is a forecast and isn’t counted as revenue.`, link: { path: '/app/leads', query: { owner: 'me' } },
    });
  }

  if (team && canSales) {
    const recurring = await q(`SELECT s.currency, COUNT(*)::int AS subs,
        SUM(CASE WHEN s.interval = 'year' THEN s."amountCents" / 12.0 ELSE s."amountCents" END)::bigint AS monthly,
        COUNT(*) FILTER (WHERE s."amountCents" IS NULL)::int AS unknown
      FROM "Subscriptions" s JOIN "BillingAccounts" b ON b.id = s."billingAccountId" JOIN "Organizations" org ON org.id = b."organizationId"
      WHERE org."managingAgencyOrganizationId" = :agencyId AND s.status IN ('active', 'past_due', 'trialing')
      AND COALESCE(s."stripeMode", 'live') NOT IN ('test', 'mock') GROUP BY 1`, r);
    const subs = recurring.reduce((s, row) => s + row.subs, 0);
    const unknown = recurring.reduce((s, row) => s + row.unknown, 0);
    out.push({
      key: 'recurring',
      label: 'Recurring revenue',
      timeframe: 'now',
      format: 'money_monthly',
      value: recurring.filter((row) => row.currency).map((row) => ({ currency: row.currency, amountCents: Number(row.monthly || 0) })),
      state: !stripe.connected && subs === 0 ? 'not_connected' : 'ok',
      note: !stripe.connected && subs === 0 ? 'Comes from Stripe subscriptions — Stripe isn’t connected.' : `Monthly equivalent of ${subs} active subscription${subs === 1 ? '' : 's'}.${unknown ? ` ${unknown} without a known amount not included.` : ''}`,
      link: { path: '/app/clients', query: {} },
    });
  } else if (canSales) {
    const { start, end } = dayBounds(ctx.offset);
    const [due] = await q(`SELECT COUNT(*) FILTER (WHERE "nextActionAt" < :end)::int AS due, COUNT(*) FILTER (WHERE "replyNeededSince" IS NOT NULL)::int AS replies
      FROM "Opportunities" WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "archivedAt" IS NULL AND "doNotContact" = false
      AND stage IN (:open) AND "assignedToUserId" = :userId`, {
      ...r, open: OPEN_STAGES, end, start,
    });
    out.push({
      key: 'due', label: 'Follow-ups due', timeframe: 'now', format: 'count', value: due.due + due.replies, state: 'ok', note: `${due.due} due or overdue today · ${due.replies} repl${due.replies === 1 ? 'y' : 'ies'} waiting.`, link: { path: '/app/today', query: {} },
    });
  }
  return out;
}

// ---------------------------------------------------------------- needs attention

function ownerWhere(ctx, team) {
  return team ? {} : { assignedToUserId: ctx.userId };
}

async function attention(ctx, {
  team, start, stripe, base,
}) {
  const items = [];
  const add = (item) => items.push(item);
  const oppInclude = [
    { model: Organization, as: 'organization', attributes: ['id', 'name'] },
    { model: User, as: 'assignedTo', attributes: ['id', 'name'] },
  ];
  const baseOpp = {
    agencyOrganizationId: ctx.agencyId, deletedAt: null, archivedAt: null, isTest: false, ...ownerWhere(ctx, team),
  };

  if (ctx.can('leads.read')) {
    const [problemRequests, handoffs, replies, overdue] = await Promise.all([
      PaymentLinkRequest.findAll({
        where: { agencyOrganizationId: ctx.agencyId, status: ['failed', 'expired'], replacedByRequestId: null },
        include: [{ model: Opportunity, as: 'opportunity', where: { ...baseOpp, stage: { [Op.ne]: 'won' } }, include: oppInclude }],
        order: [['updatedAt', 'DESC']],
        limit: 20,
      }),
      SalesHandoff.findAll({
        where: { agencyOrganizationId: ctx.agencyId, status: ['failed', 'needs_info', 'pending'] },
        include: [{
          model: Opportunity, as: 'opportunity', where: { deletedAt: null, isTest: false, ...(team ? {} : { [Op.or]: [{ creditedUserId: ctx.userId }, { assignedToUserId: ctx.userId }] }) }, include: oppInclude,
        }],
        order: [['createdAt', 'ASC']],
        limit: 20,
      }),
      Opportunity.findAll({
        where: { ...baseOpp, doNotContact: false, replyNeededSince: { [Op.ne]: null } }, include: oppInclude, order: [['replyNeededSince', 'ASC']], limit: 20,
      }),
      Opportunity.findAll({
        where: {
          ...baseOpp, doNotContact: false, stage: OPEN_STAGES, nextActionAt: { [Op.lt]: start },
        },
        include: oppInclude,
        order: [['nextActionAt', 'ASC']],
        limit: 20,
      }),
    ]);

    for (const r of problemRequests) {
      const o = r.opportunity;
      add({
        key: `opp:${o.id}`, kind: 'payment', severity: 'high', subject: o.organization?.name,
        issue: r.status === 'failed' ? 'Payment failed' : 'Checkout link expired unpaid',
        why: r.status === 'failed' ? (r.lastError || 'The customer’s payment didn’t go through.') : 'The customer didn’t pay before the checkout link expired.',
        due: r.expiresAt || null, at: r.updatedAt, owner: o.assignedTo?.name || null,
        action: { label: r.status === 'failed' ? 'Follow up on payment' : 'Send a new link', path: `/app/leads/${o.id}`, query: { tab: 'offers' } },
      });
    }
    for (const h of handoffs) {
      const o = h.opportunity;
      const missing = (h.items || []).filter((i) => i.essential && !i.done).length;
      add({
        key: `opp:${o.id}`, kind: 'handoff', severity: h.status === 'failed' ? 'high' : 'medium', subject: o.organization?.name,
        issue: h.status === 'failed' ? 'Paid, but client setup failed' : missing ? `Handoff missing ${missing} essential item${missing === 1 ? '' : 's'}` : 'Handoff ready to complete',
        why: h.status === 'failed' ? (h.lastError || 'Retry the setup so the team can start.') : 'The delivery team is waiting on these details.',
        at: h.createdAt, owner: o.assignedTo?.name || null,
        action: { label: h.status === 'failed' ? 'Retry setup' : 'Finish handoff', path: `/app/leads/${o.id}`, query: { tab: 'handoff' } },
      });
    }
    for (const o of replies) {
      add({
        key: `opp:${o.id}`, kind: 'reply', severity: 'high', subject: o.organization?.name, issue: 'Replied — waiting on us', why: o.lastInteractionSummary || 'They answered your outreach.',
        at: o.replyNeededSince, owner: o.assignedTo?.name || null, action: { label: 'Reply', path: `/app/leads/${o.id}`, query: {} },
      });
    }
    for (const o of overdue) {
      add({
        key: `opp:${o.id}`, kind: 'follow_up', severity: 'medium', subject: o.organization?.name, issue: 'Follow-up overdue', why: o.nextActionNote || 'Scheduled follow-up',
        due: o.nextActionAt, at: o.nextActionAt, owner: o.assignedTo?.name || null, action: { label: 'Open lead', path: `/app/leads/${o.id}`, query: {} },
      });
    }
  }

  // Past-due subscriptions: a confirmed billing problem on an existing client.
  if (ctx.can('projects.view') || ctx.can('leads.read')) {
    const pastDue = await q(`SELECT s.id, s.status, s."productName", s."updatedAt", org.id AS "orgId", org.name
      FROM "Subscriptions" s JOIN "BillingAccounts" b ON b.id = s."billingAccountId" JOIN "Organizations" org ON org.id = b."organizationId"
      WHERE org."managingAgencyOrganizationId" = :agencyId AND org."deletedAt" IS NULL AND s.status IN ('past_due', 'unpaid')
      AND COALESCE(s."stripeMode", 'live') NOT IN ('test', 'mock')
      ${team ? '' : `AND EXISTS (SELECT 1 FROM "Opportunities" o WHERE o."organizationId" = org.id AND COALESCE(o."creditedUserId", o."assignedToUserId") = :userId)`}
      LIMIT 20`, { agencyId: ctx.agencyId, userId: ctx.userId });
    for (const s of pastDue) {
      add({
        key: `org:${s.orgId}:billing`, kind: 'payment', severity: 'high', subject: s.name, issue: `Subscription ${s.status.replace('_', ' ')}`,
        why: `${s.productName || 'Their plan'} — Stripe couldn’t collect the latest invoice.`, at: s.updatedAt, owner: null,
        action: { label: 'Open billing', path: `/app/clients/${s.orgId}/billing`, query: {} },
      });
    }
  }

  // Client accounts that need someone (ADR 0013): waiting on us, an
  // overdue next action, unfinished onboarding. Team view shows all;
  // otherwise the clients you manage.
  if (base) {
    const ACCOUNT_KINDS = ['waiting_us', 'next_overdue', 'onboarding', 'tasks_overdue', 'waiting_client'];
    for (const c of base.needingAttention) {
      if (!team && c.managerId !== ctx.userId) continue;
      if (!c.flags.some((f) => ACCOUNT_KINDS.includes(f))) continue;
      add({
        key: `org:${c.id}:account`, kind: 'client_account', severity: c.severity || 'medium', subject: c.name, issue: 'Client needs attention', why: c.reason,
        at: null, owner: null, action: { label: 'Open client', path: `/app/clients/${c.id}`, query: {} },
      });
    }
  }

  // Clients with no way to reach anyone.
  if (team && ctx.can('projects.view')) {
    const missing = await q(`SELECT org.id, org.name FROM "Organizations" org
      WHERE org.type = 'client' AND org."managingAgencyOrganizationId" = :agencyId AND org."deletedAt" IS NULL AND org.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM "Contacts" c WHERE c."organizationId" = org.id AND c."deletedAt" IS NULL AND c."archivedAt" IS NULL AND (c.email IS NOT NULL OR c.phone IS NOT NULL))
      AND org.email IS NULL AND org.phone IS NULL
      ORDER BY org.name LIMIT 20`, { agencyId: ctx.agencyId });
    for (const c of missing) {
      add({
        key: `org:${c.id}:contact`, kind: 'client_info', severity: 'low', subject: c.name, issue: 'No contact details', why: 'Nobody at this client can be reached from Leadzaro.',
        at: null, owner: null, action: { label: 'Add a contact', path: `/app/clients/${c.id}/contacts`, query: {} },
      });
    }
  }

  // Domains: only confirmed problems — expired, or expiring soon with auto-renew known to be off.
  let domainSummary = null;
  if (ctx.can('domains.view')) {
    domainSummary = await domainHealth(ctx);
    for (const d of domainSummary.problems) add(d);
  }

  // Integrations an administrator should look at.
  if (ctx.can('integrations.manage')) {
    if (stripe.connected && stripe.problem) {
      add({
        key: 'integration:stripe', kind: 'integration', severity: 'high', subject: 'Stripe', issue: 'Needs attention', why: stripe.problem, at: null, owner: null, action: { label: 'Open Stripe settings', path: '/app/settings/integrations', query: {} },
      });
    }
    if (stripe.failedWebhooks) {
      add({
        key: 'integration:stripe-webhooks', kind: 'integration', severity: 'medium', subject: 'Stripe', issue: `${stripe.failedWebhooks} payment event${stripe.failedWebhooks === 1 ? '' : 's'} failed to process`, why: 'A payment may not have been recorded.', at: null, owner: null, action: { label: 'Review', path: '/app/settings/integrations', query: {} },
      });
    }
    const nc = domainSummary?.connection;
    if (nc && nc.state === 'attention') {
      add({
        key: 'integration:namecheap', kind: 'integration', severity: 'medium', subject: 'Namecheap', issue: 'Sync problem', why: nc.detail, at: null, owner: null, action: { label: 'Open Namecheap settings', path: '/app/settings/integrations', query: {} },
      });
    }
  }

  // One row per underlying record — the most urgent reason wins.
  const byKey = new Map();
  for (const item of items) {
    const current = byKey.get(item.key);
    if (!current || SEVERITY_RANK[item.severity] < SEVERITY_RANK[current.severity]) byKey.set(item.key, item);
  }
  const unique = [...byKey.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (a.at && b.at ? new Date(a.at) - new Date(b.at) : 0));
  const counts = {};
  for (const item of unique) counts[item.kind] = (counts[item.kind] || 0) + 1;
  return { items: unique.slice(0, 8), total: unique.length, counts, domainSummary };
}

async function domainHealth(ctx) {
  const [renewals, connection] = await Promise.all([
    renewalService.listRenewals(ctx.authContext, { window: 'all' }),
    namecheapConnectionService.getStatus(ctx.authContext).catch(() => null),
  ]);
  const domains = renewals.items.filter((i) => i.kind === 'domain' && !i.ignored);
  const soon = (i) => i.daysUntilExpiry >= 0 && i.daysUntilExpiry <= 30;
  const problems = [];
  for (const i of renewals.items) {
    if (i.ignored) continue;
    const client = i.clients?.[0];
    const path = i.kind === 'domain' ? `/app/domains/${i.id.split(':')[0]}` : '/app/domains';
    if (i.daysUntilExpiry < 0) {
      problems.push({
        key: `domain:${i.id}`, kind: 'domain', severity: 'high', subject: i.name, issue: `${i.kind === 'hosting' ? 'Hosting' : i.kind === 'ssl' ? 'Certificate' : 'Domain'} expired`,
        why: `Expired ${-i.daysUntilExpiry} day${i.daysUntilExpiry === -1 ? '' : 's'} ago${i.stale ? ' (last synced data may be out of date)' : ''}.`, at: i.expiresOn, owner: client?.name || null,
        action: { label: 'Check domain', path, query: {} },
      });
    } else if (soon(i) && i.autoRenew?.value === false) {
      problems.push({
        key: `domain:${i.id}`, kind: 'domain', severity: i.daysUntilExpiry <= 7 ? 'high' : 'medium', subject: i.name, issue: 'Expires soon with auto-renew off',
        why: `Expires in ${i.daysUntilExpiry} day${i.daysUntilExpiry === 1 ? '' : 's'} — decide whether to renew.`, due: i.expiresOn, at: i.expiresOn, owner: client?.name || null,
        action: { label: 'Review renewal', path, query: {} },
      });
    }
  }
  let state = 'not_connected';
  let detail = 'Not connected — domain dates are entered by hand.';
  if (connection?.configured) {
    const lastSync = connection.lastSuccessfulSyncAt ? new Date(connection.lastSuccessfulSyncAt) : null;
    const stale = !lastSync || Date.now() - lastSync.getTime() > 48 * 3600 * 1000;
    state = connection.lastError || stale ? 'attention' : 'connected';
    detail = connection.lastError?.message || (stale ? 'No successful sync in the last 2 days.' : 'Syncing normally.');
  }
  return {
    total: domains.length,
    expired: renewals.items.filter((i) => !i.ignored && i.daysUntilExpiry < 0).length,
    soonAutoRenewOff: renewals.items.filter((i) => !i.ignored && soon(i) && i.autoRenew?.value === false).length,
    soonAutoRenewOn: renewals.items.filter((i) => !i.ignored && soon(i) && i.autoRenew?.value === true).length,
    soonUnknown: renewals.items.filter((i) => !i.ignored && soon(i) && (i.autoRenew?.value === null || i.autoRenew?.value === undefined)).length,
    stale: domains.filter((i) => i.stale).length,
    upcoming: renewals.items.filter((i) => !i.ignored && soon(i)).sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry).slice(0, 3).map((i) => ({
      id: i.id, kind: i.kind, name: i.name, expiresOn: i.expiresOn, daysUntilExpiry: i.daysUntilExpiry, autoRenew: i.autoRenew?.value ?? null, client: i.clients?.[0]?.name || null,
    })),
    connection: { state, detail, lastSyncAt: connection?.lastSuccessfulSyncAt || null },
    problems,
  };
}

// ---------------------------------------------------------------- summaries

async function salesSummary(ctx, { team, start, end }) {
  const r = {
    agencyId: ctx.agencyId, userId: ctx.userId, open: OPEN_STAGES, start, end,
  };
  const owner = team ? '' : 'AND "assignedToUserId" = :userId';
  const rows = await q(`SELECT stage, COUNT(*)::int AS count FROM "Opportunities"
    WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "archivedAt" IS NULL AND "isTest" = false AND "doNotContact" = false AND stage IN (:open) ${owner}
    GROUP BY stage`, r);
  const [today] = await q(`SELECT COUNT(*) FILTER (WHERE "replyNeededSince" IS NOT NULL)::int AS replies,
      COUNT(*) FILTER (WHERE "nextActionAt" < :start)::int AS overdue,
      COUNT(*) FILTER (WHERE "nextActionAt" >= :start AND "nextActionAt" < :end)::int AS "dueToday",
      COUNT(*) FILTER (WHERE "nextActionAt" IS NULL AND stage <> 'nurture')::int AS "noNextStep"
    FROM "Opportunities" WHERE "agencyOrganizationId" = :agencyId AND "deletedAt" IS NULL AND "archivedAt" IS NULL AND "isTest" = false AND "doNotContact" = false AND stage IN (:open) ${owner}`, r);
  return {
    open: rows.reduce((s, row) => s + row.count, 0),
    byStage: OPEN_STAGES.map((stage) => ({ stage, label: STAGE_LABELS[stage], count: rows.find((row) => row.stage === stage)?.count || 0 })),
    ...today,
  };
}

async function clientsSummary(ctx, { base, team }) {
  const handoffsOpen = await SalesHandoff.count({ where: { agencyOrganizationId: ctx.agencyId, status: ['pending', 'needs_info', 'failed'] } });
  const mine = base.workload.find((w) => w.userId === ctx.userId) || null;
  return {
    active: base.active,
    goal: base.goal,
    newInPeriod: base.newInPeriod,
    salesToExistingInPeriod: base.salesToExistingInPeriod,
    endedInPeriod: base.endedInPeriod,
    net: base.net,
    retention: base.retention,
    activeAtStart: base.activeAtStart,
    fromSales: base.fromSales,
    existing: base.existing,
    flags: base.flags,
    handoffsOpen,
    unassigned: base.unassigned,
    workload: team ? base.workload : null,
    mine: mine ? { clients: mine.clients, attention: mine.attention, openTasks: mine.openTasks, overdueTasks: mine.overdueTasks } : { clients: 0, attention: 0, openTasks: 0, overdueTasks: 0 },
  };
}

async function recentActivity(ctx, { team, from }) {
  const events = [];
  const mineOpp = team ? {} : { [Op.or]: [{ assignedToUserId: ctx.userId }, { creditedUserId: ctx.userId }] };
  const tasks = [];
  if (ctx.can('leads.read')) {
    tasks.push(SalesPayment.findAll({
      where: {
        agencyOrganizationId: ctx.agencyId, paidAt: { [Op.gte]: from }, ...(team ? {} : { attributedUserId: ctx.userId }), stripeMode: { [Op.or]: [{ [Op.is]: null }, { [Op.notIn]: ['test', 'mock'] }] },
      },
      include: [{ model: Organization, as: 'organization', attributes: ['id', 'name'] }, { model: User, as: 'attributedTo', attributes: ['name'] }],
      order: [['paidAt', 'DESC']],
      limit: 6,
    }).then((rows) => rows.forEach((p) => events.push({
      kind: 'payment', at: p.paidAt, title: p.organization?.name, detail: `${p.kind === 'initial' ? 'New sale' : p.kind === 'renewal' ? 'Renewal' : 'Payment'} · ${p.source === 'stripe' ? 'confirmed by Stripe' : 'recorded manually'}`,
      amountCents: p.amountCents - p.amountRefundedCents, currency: p.currency, who: p.attributedTo?.name || null,
      link: p.opportunityId ? { path: `/app/leads/${p.opportunityId}`, query: { tab: 'offers' } } : { path: `/app/clients/${p.organizationId}/billing`, query: {} },
    }))));
    tasks.push(OutreachActivity.findAll({
      where: { organizationId: ctx.agencyId, direction: 'inbound', deletedAt: null, createdAt: { [Op.gte]: from } },
      include: [{
        model: Opportunity, as: 'opportunity', where: { deletedAt: null, isTest: false, ...(team ? {} : { assignedToUserId: ctx.userId }) }, attributes: ['id'], include: [{ model: Organization, as: 'organization', attributes: ['name'] }],
      }],
      order: [['createdAt', 'DESC']],
      limit: 5,
    }).then((rows) => rows.forEach((a) => events.push({
      kind: 'reply', at: a.createdAt, title: a.opportunity?.organization?.name, detail: `Replied by ${a.channel === 'sms' ? 'text' : a.channel || 'message'}`, who: null, link: { path: `/app/leads/${a.opportunityId}`, query: {} },
    }))));
    tasks.push(SalesHandoff.findAll({
      where: { agencyOrganizationId: ctx.agencyId, status: 'complete', completedAt: { [Op.gte]: from } },
      include: [{ model: Opportunity, as: 'opportunity', where: { deletedAt: null, ...mineOpp }, attributes: ['id', 'organizationId'], include: [{ model: Organization, as: 'organization', attributes: ['name'] }] }],
      order: [['completedAt', 'DESC']],
      limit: 4,
    }).then((rows) => rows.forEach((h) => events.push({
      kind: 'handoff', at: h.completedAt, title: h.opportunity?.organization?.name, detail: 'Handed off to the delivery team', who: null, link: { path: `/app/clients/${h.opportunity.organizationId}`, query: {} },
    }))));
  }
  if (ctx.can('projects.view')) {
    tasks.push(ConversionAttempt.findAll({
      where: { agencyOrganizationId: ctx.agencyId, status: 'completed', createdAt: { [Op.gte]: from } },
      include: [
        { model: Organization, as: 'resultingClientOrganization', attributes: ['id', 'name'] },
        { model: Opportunity, as: 'opportunity', attributes: ['id', 'assignedToUserId', 'creditedUserId', 'isTest'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 5,
    }).then((rows) => rows.filter((c) => !c.opportunity?.isTest && (team || c.opportunity?.creditedUserId === ctx.userId || c.opportunity?.assignedToUserId === ctx.userId)).forEach((c) => events.push({
      kind: 'client', at: c.createdAt, title: c.resultingClientOrganization?.name, detail: c.createdNewClient === false ? 'New sale to an existing client' : 'Became a client', who: null, link: { path: `/app/clients/${c.resultingClientOrganizationId}`, query: {} },
    }))));
  }
  await Promise.all(tasks);
  return events.filter((e) => e.title).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
}

// ---------------------------------------------------------------- setup checklist

async function setupChecklist(ctx, { stripe, domains }) {
  if (!ctx.can('integrations.manage') && !ctx.can('workspace.manage')) return null;
  const [org, members] = await Promise.all([
    Organization.findByPk(ctx.agencyId),
    OrganizationMembership.count({
      where: {
        organizationId: ctx.agencyId, membershipType: 'employee', status: 'active', deletedAt: null,
      },
    }),
  ]);
  const channels = await channelService.channelStatus(ctx);
  const key = process.env.GOOGLE_PLACES_API_KEY || '';
  const steps = [
    {
      key: 'stripe', done: stripe.connected && stripe.mode !== 'mock' && stripe.webhookSecretConfigured, label: 'Connect Stripe', detail: 'Needed for payment links and confirmed sales.', link: '/app/settings/integrations',
    },
    {
      key: 'email', done: channels.email.connected, label: 'Connect outreach email', detail: 'Send sales emails and email notifications from Leadzaro.', link: '/app/settings/integrations',
    },
    {
      key: 'lead_search', done: Boolean(key) && !key.includes('your_google') && process.env.DEMO_MODE !== 'true', label: 'Add the Google Places key', detail: 'Find Leads only returns demo businesses without it.', link: '/app/settings/integrations',
    },
    {
      key: 'namecheap', done: Boolean(domains?.connection && domains.connection.state !== 'not_connected'), label: 'Connect Namecheap', detail: 'Keeps domain expiry dates current.', link: '/app/settings/integrations',
    },
    {
      key: 'company', done: Boolean(org.phone || org.email), label: 'Add company contact details', detail: 'Used in templates and client-facing messages.', link: '/app/settings/workspace',
    },
    {
      key: 'timezone', done: Boolean(org.settings?.timezone), label: 'Set the workspace timezone', detail: 'So “today” and “overdue” mean the same thing for everyone.', link: '/app/settings/workspace',
    },
    {
      key: 'team', done: members > 1, label: 'Invite your team', detail: 'Give each salesperson their own login.', link: '/app/settings/team',
    },
  ];
  return { remaining: steps.filter((s) => !s.done), total: steps.length };
}

// ---------------------------------------------------------------- entry point

async function getOverview(ctx, query = {}) {
  const canTeam = ctx.can('sales.view_team');
  const team = query.scope === 'team' && canTeam;
  const periodKey = PERIODS[query.period] ? String(query.period) : '30';
  const offset = effectiveOffset(ctx.timezone, query.tzOffset);
  const scopedCtx = { ...ctx, offset };
  const { from, to } = periodRange(periodKey, offset);
  const { start, end } = dayBounds(offset);
  const stripe = await stripeService.getStatus();
  // One client-base computation shared by the metric, attention list and client panel.
  const base = ctx.can('projects.view')
    ? await clientBase(ctx.authContext, {
      from, to, todayKey: localDateKey(offset), goal: ctx.authContext.organization.settings?.clientGoal || 100,
    })
    : null;

  const [metricList, attn, sales, clients, activity] = await Promise.all([
    metrics(scopedCtx, {
      team, from, to, stripe, base,
    }),
    attention(scopedCtx, {
      team, start, stripe, base,
    }),
    ctx.can('leads.read') ? salesSummary(scopedCtx, { team, start, end }) : null,
    base ? clientsSummary(scopedCtx, { base, team }) : null,
    recentActivity(scopedCtx, { team, from }),
  ]);
  const { domainSummary, ...attentionList } = attn;
  if (domainSummary) delete domainSummary.problems;

  return {
    scope: team ? 'team' : 'mine',
    canSeeTeam: canTeam,
    period: {
      key: periodKey, label: PERIODS[periodKey], from, to,
    },
    timezone: ctx.timezone,
    generatedAt: new Date(),
    metrics: metricList,
    attention: attentionList,
    sales,
    clients,
    activity,
    domains: domainSummary,
    stripe: { connected: stripe.connected, mode: stripe.mode, lastWebhookAt: stripe.lastWebhookAt },
    setup: await setupChecklist(scopedCtx, { stripe, domains: domainSummary }),
  };
}

module.exports = { getOverview };

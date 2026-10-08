'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize, User } = require('../../models');
const {
  listClientOrganizationsForRequester, listClientProfilesForRequester, listContactsForRequester, listProjectsForRequester,
} = require('../../core/authorization/clientVisibleModels');
const clientHealth = require('./clientHealth');

/**
 * The client base in numbers (ADR 0013) — for the Dashboard and Reports.
 *
 * - Active clients are client records not marked as ended.
 * - New clients are sales that created a client (or won one back) in the
 *   period. Sales to an existing client are counted separately, and
 *   existing clients added directly are never counted as new.
 * - Test data (demo leads, Stripe test/mock payments) is excluded unless
 *   asked for, both from new clients and from the active count.
 * - Retention compares the clients active at the start of the period with
 *   those that ended during it.
 */

async function q(sql, replacements) {
  return sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
}

// A client that only exists because of a test sale (demo lead or Stripe test/mock payment).
const TEST_CLIENT_SQL = `(COALESCE(p."acquisitionSource", 'existing') = 'sales' AND EXISTS (
    SELECT 1 FROM "ConversionAttempts" ca JOIN "Opportunities" o ON o.id = ca."opportunityId"
    WHERE ca."resultingClientOrganizationId" = org.id AND ca.status = 'completed')
  AND NOT EXISTS (
    SELECT 1 FROM "ConversionAttempts" ca JOIN "Opportunities" o ON o.id = ca."opportunityId"
    WHERE ca."resultingClientOrganizationId" = org.id AND ca.status = 'completed' AND COALESCE(o."isTest", false) = false
      AND NOT EXISTS (SELECT 1 FROM "SalesPayments" sp WHERE sp."opportunityId" = o.id AND sp.kind = 'initial' AND COALESCE(sp."stripeMode", 'live') IN ('test', 'mock'))))`;

function dateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function clientBase(authContext, {
  from, to, includeTest = false, todayKey, goal = 100,
}) {
  const agencyId = authContext.organization.id;
  const r = {
    agencyId, from, to, fromDate: dateKey(from), toDate: dateKey(to),
  };
  const notTest = includeTest ? '' : `AND NOT ${TEST_CLIENT_SQL}`;
  const realSale = includeTest ? '' : `AND COALESCE(o."isTest", false) = false
    AND NOT EXISTS (SELECT 1 FROM "SalesPayments" sp WHERE sp."opportunityId" = o.id AND sp.kind = 'initial' AND COALESCE(sp."stripeMode", 'live') IN ('test', 'mock'))`;

  const [[base], [sales], ended, [start]] = await Promise.all([
    q(`SELECT COUNT(*) FILTER (WHERE p."clientEndedAt" IS NULL)::int AS active,
         COUNT(*) FILTER (WHERE p."clientEndedAt" IS NULL AND p."acquisitionSource" = 'sales')::int AS "fromSales",
         COUNT(*) FILTER (WHERE p."clientEndedAt" IS NULL AND COALESCE(p."acquisitionSource", 'existing') = 'existing')::int AS existing
       FROM "Organizations" org LEFT JOIN "ClientProfiles" p ON p."organizationId" = org.id AND p."agencyOrganizationId" = :agencyId
       WHERE org.type = 'client' AND org."managingAgencyOrganizationId" = :agencyId AND org."deletedAt" IS NULL ${notTest}`, r),
    q(`SELECT COUNT(DISTINCT ca."resultingClientOrganizationId") FILTER (WHERE ca."createdNewClient")::int AS "newClients",
         COUNT(*) FILTER (WHERE NOT ca."createdNewClient")::int AS "existingClientSales"
       FROM "ConversionAttempts" ca JOIN "Opportunities" o ON o.id = ca."opportunityId"
       WHERE ca."agencyOrganizationId" = :agencyId AND ca.status = 'completed' AND ca."createdAt" >= :from AND ca."createdAt" <= :to ${realSale}`, r),
    q(`SELECT org.id, org.name, p."clientEndedAt", p."endReason"
       FROM "Organizations" org JOIN "ClientProfiles" p ON p."organizationId" = org.id AND p."agencyOrganizationId" = :agencyId
       WHERE org.type = 'client' AND org."managingAgencyOrganizationId" = :agencyId AND org."deletedAt" IS NULL
         AND p."clientEndedAt" >= :fromDate AND p."clientEndedAt" <= :toDate ${notTest}
       ORDER BY p."clientEndedAt" DESC`, r),
    q(`SELECT COUNT(*)::int AS "activeAtStart"
       FROM "Organizations" org LEFT JOIN "ClientProfiles" p ON p."organizationId" = org.id AND p."agencyOrganizationId" = :agencyId
       WHERE org.type = 'client' AND org."managingAgencyOrganizationId" = :agencyId AND org."deletedAt" IS NULL
         AND COALESCE(p."clientSince", org."createdAt"::date) < :fromDate
         AND (p."clientEndedAt" IS NULL OR p."clientEndedAt" >= :fromDate) ${notTest}`, r),
  ]);

  const endedFromStart = ended.length;
  const retention = start.activeAtStart
    ? { numerator: Math.max(0, start.activeAtStart - endedFromStart), denominator: start.activeAtStart }
    : null;

  // Account health across every active client, with the same rules as the Clients list.
  const organizations = await listClientOrganizationsForRequester(authContext);
  const ids = organizations.map((o) => o.id);
  const [profiles, contacts, projects] = ids.length ? await Promise.all([
    listClientProfilesForRequester(authContext, ids),
    listContactsForRequester(authContext, { organizationId: ids }),
    listProjectsForRequester(authContext, { organizationId: ids }),
  ]) : [[], [], []];
  const profileJson = profiles.map((p) => p.toJSON());
  const facts = await clientHealth.loadFacts(agencyId, ids, { profiles: profileJson, contacts, projects });
  const profileByOrg = new Map(profileJson.map((p) => [p.organizationId, p]));
  const flagCounts = Object.fromEntries(Object.keys(clientHealth.FILTERS).filter((k) => k !== 'mine').map((k) => [k, 0]));
  const perManager = new Map();
  const needing = [];
  for (const organization of organizations) {
    const profile = profileByOrg.get(organization.id);
    if (profile?.clientEndedAt) continue;
    const health = clientHealth.assess(facts.get(organization.id), { todayKey });
    for (const flag of health.flags) if (flagCounts[flag] !== undefined) flagCounts[flag] += 1;
    const managerId = profile?.accountManagerUserId || null;
    if (!perManager.has(managerId)) perManager.set(managerId, { clients: 0, attention: 0 });
    const row = perManager.get(managerId);
    row.clients += 1;
    if (health.flags.includes('attention')) {
      row.attention += 1;
      needing.push({
        id: organization.id, name: organization.name, severity: health.severity, reason: health.reasons[0]?.text || '', flags: health.flags, managerId,
      });
    }
  }

  const tasks = await q(`SELECT t."assigneeUserId" AS "userId",
      COUNT(*) FILTER (WHERE t.status <> 'done')::int AS open,
      COUNT(*) FILTER (WHERE t.status <> 'done' AND t."dueDate" < CURRENT_DATE)::int AS overdue
    FROM "Tasks" t WHERE t."agencyOrganizationId" = :agencyId AND t."archivedAt" IS NULL GROUP BY 1`, r);
  const userIds = new Set([...perManager.keys(), ...tasks.map((t) => t.userId)].filter(Boolean));
  const users = userIds.size ? await User.findAll({ where: { id: [...userIds] }, attributes: ['id', 'name'] }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const workload = [...userIds].map((id) => {
    const m = perManager.get(id) || { clients: 0, attention: 0 };
    const t = tasks.find((row) => row.userId === id) || { open: 0, overdue: 0 };
    return {
      userId: id, name: names.get(id) || 'Former team member', clients: m.clients, attention: m.attention, openTasks: t.open, overdueTasks: t.overdue,
    };
  }).sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
  const unassigned = perManager.get(null);

  const rank = { high: 0, medium: 1, low: 2 };
  needing.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.name.localeCompare(b.name));

  return {
    active: base.active,
    fromSales: base.fromSales,
    existing: base.existing,
    goal: { target: goal, remaining: Math.max(0, goal - base.active) },
    newInPeriod: sales.newClients,
    salesToExistingInPeriod: sales.existingClientSales,
    endedInPeriod: endedFromStart,
    endedClients: ended.slice(0, 10).map((e) => ({
      id: e.id, name: e.name, endedAt: e.clientEndedAt, reason: e.endReason,
    })),
    net: sales.newClients - endedFromStart,
    activeAtStart: start.activeAtStart,
    retention,
    flags: flagCounts,
    workload,
    unassigned: unassigned ? unassigned.clients : 0,
    needingAttention: needing.slice(0, 10),
    includeTest,
  };
}

module.exports = { clientBase, TEST_CLIENT_SQL };

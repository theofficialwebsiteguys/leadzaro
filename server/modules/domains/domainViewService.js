'use strict';

const { Organization } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const {
  linkState, domainFacts, LINK_STATE_LABELS, recordOwnership, isProviderBacked, annualize, tally,
} = require('../../core/domains/domainFacts');
const { listProjectsForRequester, listClientProfilesForRequester } = require('../../core/authorization/clientVisibleModels');
const connectionService = require('../integrations/namecheapConnectionService');
const hostingService = require('./hostingService');
const { expenseDto } = require('./expenseService');
const { normalizeDomainManualInput } = require('./domainFields');

/**
 * Read models for the "Domains & Hosting" areas (ADR 0009). Registrar
 * facts are visible to every agency team member who can view projects;
 * costs, renewal amounts, what we charge and payments only to people who
 * can manage projects — the same line the client hub already draws for
 * internal costs (ADR 0008).
 */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const FREQUENCY_MONTHS = {
  monthly: 1, quarterly: 3, annually: 12,
};

function canSeeInternals(context) {
  return Boolean(context.permissionKeys?.has('projects.manage'));
}

function connectionSummary(connection) {
  if (!connection) {
    return {
      provider: 'namecheap', connected: false, status: 'not_configured', lastSuccessfulSyncAt: null, syncing: false,
    };
  }
  const dto = connectionService.toStatusDto(connection);
  return {
    provider: 'namecheap',
    connected: dto.configured && dto.status === 'connected',
    configured: dto.configured,
    status: dto.status,
    lastSuccessfulSyncAt: dto.lastSuccessfulSyncAt,
    lastSyncStatus: dto.lastSyncStatus,
    syncing: dto.syncing,
    lastError: dto.lastError ? { kind: dto.lastError.kind, message: dto.lastError.message } : null,
  };
}

function withoutInternals(facts) {
  const { renewal, clientCharge, ...rest } = facts;
  return rest;
}

async function organizationNames(agencyOrganizationId, ids) {
  if (!ids.length) return new Map();
  const rows = await Organization.findAll({
    where: { id: ids, managingAgencyOrganizationId: agencyOrganizationId, deletedAt: null }, attributes: ['id', 'name'],
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Does this domain's cost belong to this client? Only when it is unambiguously theirs. */
function countsForClient(record, allLinks, organizationId) {
  const active = allLinks.filter((link) => link.linkOverride !== 'rejected');
  if (!active.length) return false;
  if (!isProviderBacked(record)) return active.every((link) => link.organizationId === organizationId);
  const ownership = recordOwnership(record, allLinks);
  return ownership.status === 'linked' && ownership.organizationIds.includes(organizationId);
}

function clientBillingAnnual(profile) {
  if (!profile || profile.recurringPriceCents === null || profile.recurringPriceCents === undefined) return null;
  const months = FREQUENCY_MONTHS[profile.billingFrequency];
  return months ? annualize(profile.recurringPriceCents, months) : null;
}

function costSummary({
  domains, hosting, profile, now,
}) {
  const direct = domains.filter((domain) => domain.countsForClient).map((domain) => ({
    kind: 'domain',
    name: domain.displayName,
    annualCents: annualize(domain.renewal.cents, domain.renewal.periodMonths),
    source: domain.renewal.source,
    currency: domain.renewal.currency,
  }));
  const allocated = hosting.filter((plan) => plan.allocationMethod !== 'none').map((plan) => {
    const mine = plan.clients[0];
    return {
      kind: 'hosting',
      name: plan.name,
      annualCents: mine?.shareAnnualCents ?? null,
      source: 'manual',
      method: plan.allocationMethod,
      shared: plan.shared,
      currency: plan.currency,
    };
  });
  const overhead = hosting.filter((plan) => plan.allocationMethod === 'none').map((plan) => plan.name);
  const paidLast12MonthsCents = domains
    .filter((domain) => domain.countsForClient)
    .flatMap((domain) => domain.expenses || [])
    .filter((expense) => now - new Date(expense.paidOn) <= YEAR_MS)
    .reduce((sum, expense) => sum + expense.amountCents, 0);
  const chargedForDomains = domains
    .filter((domain) => domain.countsForClient && domain.clientCharge)
    .map((domain) => annualize(domain.clientCharge.cents, domain.clientCharge.periodMonths));

  return {
    direct: { items: direct, ...tally(direct.map((item) => item.annualCents)) },
    allocatedHosting: { items: allocated, ...tally(allocated.map((item) => item.annualCents)) },
    total: tally([...direct, ...allocated].map((item) => item.annualCents)),
    notCharged: overhead,
    needsReview: domains.filter((domain) => !domain.countsForClient && domain.links.some((link) => ['conflict', 'review'].includes(link.state))).length,
    paidLast12MonthsCents,
    clientPays: {
      recurringAnnualCents: clientBillingAnnual(profile),
      recurringPriceCents: profile?.recurringPriceCents ?? null,
      billingFrequency: profile?.billingFrequency ?? null,
      setupPriceCents: profile?.setupPriceCents ?? null,
      domainChargesAnnual: tally(chargedForDomains),
    },
  };
}

/**
 * Everything the client's Domains & Hosting tab shows. With `projectId`,
 * the same data narrowed to one project (plus the client-wide domains it
 * inherits), for the project workspace.
 */
async function clientDomainsView(context, organization, { projectId = null } = {}) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const includeInternals = canSeeInternals(context);
  const now = new Date();

  const [connection, ownLinks, projects, [profile]] = await Promise.all([
    connectionService.getConnection(agencyOrganizationId),
    access.domainLinks.findAll(agencyOrganizationId, { where: { organizationId: organization.id }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] }),
    listProjectsForRequester(context, { organizationId: organization.id }),
    includeInternals ? listClientProfilesForRequester(context, [organization.id]) : [null],
  ]);
  const projectNames = new Map(projects.map((project) => [project.id, project.name || organization.name]));
  const recordIds = [...new Set(ownLinks.map((link) => link.domainRecordId))];

  const [records, allLinks, expenses] = recordIds.length
    ? await Promise.all([
      access.domainRecords.findAll(agencyOrganizationId, { where: { id: recordIds } }),
      access.domainLinks.findAll(agencyOrganizationId, { where: { domainRecordId: recordIds } }),
      includeInternals ? access.expenses.findAll(agencyOrganizationId, { where: { domainRecordId: recordIds }, order: [['paidOn', 'DESC']] }) : [],
    ])
    : [[], [], []];
  const otherNames = await organizationNames(agencyOrganizationId, [...new Set(allLinks.map((link) => link.organizationId).filter((id) => id !== organization.id))]);

  let domains = records.map((record) => {
    const linksToRecord = allLinks.filter((link) => link.domainRecordId === record.id);
    const facts = domainFacts(record, connection, now);
    const links = linksToRecord.filter((link) => link.organizationId === organization.id).map((link) => {
      const state = linkState(link, record, linksToRecord, connection);
      return {
        id: link.id,
        projectId: link.projectId,
        projectName: link.projectId ? projectNames.get(link.projectId) || 'Project' : null,
        hostname: link.hostname,
        source: link.source,
        isPrimary: link.isPrimary,
        override: link.linkOverride,
        state: state.state,
        stateLabel: LINK_STATE_LABELS[state.state],
        linkedBy: state.linkedBy || null,
        otherClients: (state.otherOrganizationIds || []).map((id) => ({ id, name: otherNames.get(id) || 'Another client' })),
      };
    });
    // Registrar data shows only where a link is actually matched; otherwise just the manual layer,
    // plus — while a conflict or subdomain match awaits review — a preview of what Namecheap reports.
    const showsProvider = links.some((link) => ['linked', 'missing'].includes(link.state));
    const visibleFacts = showsProvider ? facts : domainFacts({ ...record.get(), providerKey: null, providerLastSeenAt: null }, connection, now);
    const awaitingReview = !showsProvider && links.some((link) => ['conflict', 'review'].includes(link.state));
    // A registration this client doesn't own (disputed, or unlinked here): no
    // details, costs or edit actions — only the decision and a preview.
    const ownsRegistration = links.some((link) => ['linked', 'missing', 'manual', 'not_found', 'pending'].includes(link.state));
    if (!ownsRegistration) {
      return {
        id: record.id,
        domainName: record.domainName,
        displayName: facts.displayName,
        restricted: true,
        providerMatched: false,
        providerPreview: awaitingReview ? {
          registrar: facts.registrar.value, expiresOn: facts.expiresOn.value, daysUntilExpiry: facts.daysUntilExpiry, autoRenew: facts.autoRenew.value,
        } : null,
        links,
        countsForClient: false,
      };
    }
    const recordExpenses = includeInternals ? expenses.filter((expense) => expense.domainRecordId === record.id).map(expenseDto) : undefined;
    return {
      id: record.id,
      ...(includeInternals ? visibleFacts : withoutInternals(visibleFacts)),
      providerMatched: showsProvider,
      providerPreview: awaitingReview ? {
        registrar: facts.registrar.value, expiresOn: facts.expiresOn.value, daysUntilExpiry: facts.daysUntilExpiry, autoRenew: facts.autoRenew.value,
      } : null,
      links,
      countsForClient: countsForClient(record, linksToRecord, organization.id),
      ...(includeInternals ? { expenses: recordExpenses } : {}),
    };
  });

  let hosting = await hostingService.plansForClient(context, organization.id);
  if (projectId) {
    domains = domains
      .map((domain) => ({ ...domain, relevance: domain.links.some((link) => link.projectId === projectId) ? 'project' : 'client' }))
      .filter((domain) => domain.relevance === 'project' || domain.links.some((link) => link.projectId === null));
    hosting = hosting
      .map((plan) => ({ ...plan, relevance: plan.clients.some((c) => c.projects.some((p) => p.id === projectId)) ? 'project' : 'client' }))
      .filter((plan) => plan.relevance === 'project' || plan.clients.some((c) => c.projects.length === 0));
  }

  return {
    connection: connectionSummary(connection),
    canSeeInternals: includeInternals,
    projects: projects.map((project) => ({ id: project.id, name: project.name || organization.name })),
    domains,
    hosting,
    costs: includeInternals && !projectId ? costSummary({
      domains, hosting, profile, now,
    }) : null,
  };
}

/** Manual fields and overrides only; a sync never writes these, and these never write provider values. */
async function updateDomainDetails(context, domainRecordId, input, actorUserId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const record = await access.domainRecords.findOne(agencyOrganizationId, { where: { id: domainRecordId } });
  if (!record) {
    const err = new Error('Domain not found');
    err.statusCode = 404;
    throw err;
  }
  const fields = normalizeDomainManualInput(input || {});
  if (!Object.keys(fields).length) return { record, changed: [] };
  await record.update({ ...fields, manualUpdatedAt: new Date(), manualUpdatedByUserId: actorUserId });
  return { record, changed: Object.keys(fields) };
}

module.exports = {
  canSeeInternals,
  connectionSummary,
  clientDomainsView,
  updateDomainDetails,
  withoutInternals,
};

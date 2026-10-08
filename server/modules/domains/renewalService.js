'use strict';

const { Organization } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const {
  domainFacts, recordOwnership, daysUntil, toDateOnly, annualize,
} = require('../../core/domains/domainFacts');
const { listProjectsForRequester } = require('../../core/authorization/clientVisibleModels');
const connectionService = require('../integrations/namecheapConnectionService');
const hostingService = require('./hostingService');

/**
 * The upcoming-renewals view (ADR 0009): domains, Namecheap SSL
 * certificates and hosting plans with a known expiration date, soonest
 * first. Auto-renew never hides an item — it is a setting, not proof the
 * renewal succeeded. Costs are shown as known, estimated or unknown, and
 * only to people who can manage projects.
 */

const WINDOWS = {
  expired: (days) => days < 0,
  7: (days) => days >= 0 && days <= 7,
  30: (days) => days >= 0 && days <= 30,
  60: (days) => days >= 0 && days <= 60,
  all: () => true,
};

function canSeeInternals(context) {
  return Boolean(context.permissionKeys?.has('projects.manage'));
}

async function listRenewals(context, { window = '60' } = {}) {
  if (!WINDOWS[window]) {
    const err = new Error('window must be expired, 7, 30, 60 or all');
    err.statusCode = 422;
    throw err;
  }
  const agencyOrganizationId = access.agencyIdFor(context);
  const includeInternals = canSeeInternals(context);
  const now = new Date();

  const [connection, records, links, plans] = await Promise.all([
    connectionService.getConnection(agencyOrganizationId),
    access.domainRecords.findAll(agencyOrganizationId, {}),
    access.domainLinks.findAll(agencyOrganizationId, {}),
    hostingService.listPlans(context),
  ]);
  const orgIds = [...new Set(links.map((link) => link.organizationId))];
  const [orgs, projects] = await Promise.all([
    orgIds.length ? Organization.findAll({ where: { id: orgIds, managingAgencyOrganizationId: agencyOrganizationId, deletedAt: null }, attributes: ['id', 'name'] }) : [],
    orgIds.length ? listProjectsForRequester(context, { organizationId: orgIds }) : [],
  ]);
  const orgNames = new Map(orgs.map((org) => [org.id, org.name]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name || orgNames.get(project.organizationId) || 'Project']));

  const items = [];
  for (const record of records) {
    const recordLinks = links.filter((link) => link.domainRecordId === record.id);
    const ownership = recordOwnership(record, recordLinks);
    const owners = ownership.organizationIds.map((id) => ({
      id,
      name: orgNames.get(id) || 'Client',
      projects: recordLinks.filter((link) => link.organizationId === id && link.projectId && link.linkOverride !== 'rejected').map((link) => ({ id: link.projectId, name: projectNames.get(link.projectId) || 'Project' })),
    }));
    const facts = domainFacts(record, connection, now);
    if (facts.expiresOn.value) {
      items.push({
        kind: 'domain',
        id: record.id,
        name: facts.displayName,
        expiresOn: facts.expiresOn.value,
        expiresSource: facts.expiresOn.source,
        daysUntilExpiry: facts.daysUntilExpiry,
        autoRenew: facts.autoRenew,
        status: ownership.status,
        ignored: Boolean(record.ignoredAt),
        clients: owners,
        inConnectedAccount: facts.inConnectedAccount,
        stale: facts.sync.stale,
        ...(includeInternals ? {
          cost: {
            cents: facts.renewal.cents, currency: facts.renewal.currency, periodMonths: facts.renewal.periodMonths, source: facts.renewal.source,
          },
        } : {}),
      });
    }
    for (const certificate of facts.sslCertificates) {
      if (!certificate.expiresOn) continue;
      items.push({
        kind: 'ssl',
        id: `${record.id}:${certificate.certificateId}`,
        name: `SSL · ${certificate.hostName || facts.displayName}`,
        expiresOn: certificate.expiresOn,
        expiresSource: 'namecheap',
        daysUntilExpiry: daysUntil(certificate.expiresOn, now),
        autoRenew: { value: null, source: null },
        status: ownership.status,
        clients: owners,
        certificateStatus: certificate.status,
        ...(includeInternals ? { cost: { cents: null, source: null } } : {}),
      });
    }
  }
  for (const plan of plans) {
    if (!plan.expiresOn) continue;
    items.push({
      kind: 'hosting',
      id: plan.id,
      name: plan.name,
      expiresOn: toDateOnly(plan.expiresOn),
      expiresSource: 'manual',
      daysUntilExpiry: plan.daysUntilExpiry,
      autoRenew: { value: plan.autoRenew, source: plan.autoRenew === null ? null : 'manual' },
      status: plan.clientCount ? 'linked' : 'unlinked',
      shared: plan.shared,
      clients: plan.clients.map((client) => ({ id: client.organizationId, name: client.clientName, projects: client.projects })),
      ...(includeInternals ? {
        cost: {
          cents: plan.costCents, currency: plan.currency, periodMonths: plan.billingPeriodMonths, source: plan.costCents === null ? null : 'manual', annualCents: annualize(plan.costCents, plan.billingPeriodMonths),
        },
      } : {}),
    });
  }

  const counts = Object.fromEntries(Object.entries(WINDOWS).map(([key, test]) => [key, items.filter((item) => test(item.daysUntilExpiry)).length]));
  const selected = items.filter((item) => WINDOWS[window](item.daysUntilExpiry)).sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  return {
    window, counts, items: selected, canSeeInternals: includeInternals,
  };
}

module.exports = { listRenewals, WINDOWS };

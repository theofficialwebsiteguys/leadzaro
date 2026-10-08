'use strict';

const { Organization } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const {
  domainFacts, recordOwnership, isProviderBacked, linkState, LINK_STATE_LABELS,
} = require('../../core/domains/domainFacts');
const { listProjectsForRequester } = require('../../core/authorization/clientVisibleModels');
const connectionService = require('../integrations/namecheapConnectionService');
const { withoutInternals } = require('./domainViewService');

/**
 * The Domains inventory and the single-domain page (ADR 0010). Every domain
 * the workspace knows about is listed — assigned or not, expiring or not,
 * with or without cost data; expiration is a detail, never a filter that
 * hides a domain by default.
 */

const EXPIRING_DAYS = 30;

function hasPermission(context, key) {
  return Boolean(context.permissionKeys?.has(key));
}

async function namesFor(context, agencyOrganizationId, links) {
  const orgIds = [...new Set(links.map((l) => l.organizationId))];
  if (!orgIds.length) return { orgNames: new Map(), projectNames: new Map() };
  const [orgs, projects] = await Promise.all([
    Organization.findAll({ where: { id: orgIds, managingAgencyOrganizationId: agencyOrganizationId, deletedAt: null }, attributes: ['id', 'name'] }),
    listProjectsForRequester(context, { organizationId: orgIds }),
  ]);
  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));
  return { orgNames, projectNames: new Map(projects.map((p) => [p.id, p.name || orgNames.get(p.organizationId) || 'Project'])) };
}

function statusOf(record) {
  if (!isProviderBacked(record)) return { key: 'manual', label: 'Not in connected account' };
  if (record.providerMissingSince) return { key: 'missing', label: 'Not found in connected account' };
  if (record.providerIsExpired) return { key: 'expired', label: 'Expired' };
  return { key: 'active', label: 'Active' };
}

function dnsOf(record) {
  if (!isProviderBacked(record)) return { managedAt: record.dnsProviderName || null, nameservers: null, usesNamecheapDns: null };
  return {
    usesNamecheapDns: record.providerUsesNamecheapDns,
    nameservers: record.providerNameservers,
    managedAt: record.providerUsesNamecheapDns === true ? 'Namecheap DNS' : (record.dnsProviderName || null),
  };
}

function syncSummary(connection) {
  const dto = connectionService.toStatusDto(connection);
  let state = 'not_connected';
  if (dto.configured && dto.syncing) state = 'syncing';
  else if (dto.configured && !dto.lastSuccessfulSyncAt && !dto.lastSyncStatus) state = 'never_synced';
  else if (dto.configured && (dto.lastSyncStatus === 'failed' || dto.lastSyncStatus === 'interrupted')) state = 'failed';
  else if (dto.configured && dto.lastSyncStatus === 'partial') state = 'incomplete';
  else if (dto.configured && dto.lastSuccessfulSyncAt) state = 'ok';
  else if (dto.configured) state = 'never_synced';
  return {
    state,
    status: dto.status,
    configured: dto.configured,
    syncing: dto.syncing,
    lastSuccessfulSyncAt: dto.lastSuccessfulSyncAt || null,
    lastSyncFinishedAt: dto.lastSyncFinishedAt || null,
    lastSyncStatus: dto.lastSyncStatus || null,
    domainsInAccount: dto.lastSyncSummary?.domainsSeen ?? null,
    lastError: dto.lastError ? dto.lastError.message : null,
  };
}

async function inventory(context, { filter = 'all', q = '' } = {}) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const [connection, records, links] = await Promise.all([
    connectionService.getConnection(agencyOrganizationId),
    access.domainRecords.findAll(agencyOrganizationId, { order: [['domainName', 'ASC']] }),
    access.domainLinks.findAll(agencyOrganizationId, {}),
  ]);
  const { orgNames, projectNames } = await namesFor(context, agencyOrganizationId, links);
  const now = new Date();

  const items = records.map((record) => {
    const recordLinks = links.filter((l) => l.domainRecordId === record.id && l.linkOverride !== 'rejected');
    const ownership = recordOwnership(record, recordLinks);
    const facts = domainFacts(record, connection, now);
    const status = statusOf(record);
    const attention = [];
    if (ownership.status === 'conflict') attention.push('Claimed by more than one client');
    if (ownership.status === 'review' && isProviderBacked(record)) attention.push('Matched by subdomain only');
    if (status.key === 'missing') attention.push('No longer in the connected account');
    if (status.key === 'expired') attention.push('Expired');
    if (facts.sync.stale) attention.push('Details may be out of date');
    if (record.providerNameserversError) attention.push(record.providerNameserversError);
    const clients = ownership.organizationIds.map((id) => ({
      id,
      name: orgNames.get(id) || 'Client',
      projects: recordLinks.filter((l) => l.organizationId === id && l.projectId).map((l) => ({ id: l.projectId, name: projectNames.get(l.projectId) || 'Project' })),
    }));
    return {
      id: record.id,
      domainName: record.domainName,
      displayName: facts.displayName,
      assigned: ownership.status === 'linked' || (!isProviderBacked(record) && recordLinks.length > 0),
      clients,
      status,
      dns: dnsOf(record),
      expiresOn: facts.expiresOn.value,
      daysUntilExpiry: facts.daysUntilExpiry,
      autoRenew: facts.autoRenew.value,
      locked: isProviderBacked(record) ? record.providerIsLocked : null,
      ignored: Boolean(record.ignoredAt),
      inConnectedAccount: facts.inConnectedAccount,
      attention,
    };
  });

  const expiring = (i) => i.daysUntilExpiry !== null && i.daysUntilExpiry <= EXPIRING_DAYS;
  const filters = {
    all: () => true,
    assigned: (i) => i.assigned,
    unassigned: (i) => !i.assigned,
    expiring,
    attention: (i) => i.attention.length > 0,
  };
  if (!filters[filter]) {
    const err = new Error('filter must be all, assigned, unassigned, expiring or attention');
    err.statusCode = 422;
    throw err;
  }
  const needle = String(q || '').trim().toLowerCase();
  const matches = (i) => !needle || i.domainName.includes(needle) || i.displayName.toLowerCase().includes(needle)
    || i.clients.some((c) => c.name.toLowerCase().includes(needle) || c.projects.some((p) => p.name.toLowerCase().includes(needle)));

  return {
    sync: syncSummary(connection),
    counts: Object.fromEntries(Object.entries(filters).map(([key, test]) => [key, items.filter(test).length])),
    total: items.length,
    items: items.filter(filters[filter]).filter(matches),
  };
}

/** One domain, the same record whether opened from Domains or from a client. */
async function detail(context, domainRecordId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const record = await access.domainRecords.findOne(agencyOrganizationId, { where: { id: domainRecordId } });
  if (!record) {
    const err = new Error('Domain not found');
    err.statusCode = 404;
    throw err;
  }
  const [connection, links] = await Promise.all([
    connectionService.getConnection(agencyOrganizationId),
    access.domainLinks.findAll(agencyOrganizationId, { where: { domainRecordId: record.id } }),
  ]);
  const { orgNames, projectNames } = await namesFor(context, agencyOrganizationId, links);
  const facts = domainFacts(record, connection);
  const ownership = recordOwnership(record, links);
  const managedHere = Boolean(connection?.credentialsCiphertext) && isProviderBacked(record) && !record.providerMissingSince;
  return {
    id: record.id,
    ...withoutInternals(facts),
    status: statusOf(record),
    dns: dnsOf(record),
    locked: isProviderBacked(record) ? record.providerIsLocked : null,
    ownership: ownership.status,
    links: links.map((link) => {
      const state = linkState(link, record, links, connection);
      return {
        id: link.id,
        clientId: link.organizationId,
        clientName: orgNames.get(link.organizationId) || 'Client',
        projectId: link.projectId,
        projectName: link.projectId ? projectNames.get(link.projectId) || 'Project' : null,
        hostname: link.hostname,
        source: link.source,
        state: state.state,
        stateLabel: LINK_STATE_LABELS[state.state],
      };
    }),
    sync: syncSummary(connection),
    websiteUrl: `https://${record.domainName}`,
    namecheapUrl: isProviderBacked(record) ? `https://ap.www.namecheap.com/domains/domaincontrolpanel/${record.domainName}/domain` : null,
    inConnectedAccount: managedHere,
    canLink: hasPermission(context, 'projects.manage'),
  };
}

module.exports = { inventory, detail };

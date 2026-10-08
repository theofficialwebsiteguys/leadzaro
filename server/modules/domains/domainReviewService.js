'use strict';

const { sequelize, ClientDomainLink, Contact } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const {
  domainFacts, recordOwnership, linkState, isProviderBacked, LINK_STATE_LABELS,
} = require('../../core/domains/domainFacts');
const { suggestClientName, nameResemblance, displayDomain } = require('../../core/domains/domainName');
const {
  getClientOrganizationForRequester, listClientOrganizationsForRequester, listProjectsForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { runInBackground } = require('../../core/jobs/background');
const connectionService = require('../integrations/namecheapConnectionService');
const syncService = require('../integrations/namecheapSyncService');
const domainLinkService = require('./domainLinkService');
const { connectionSummary } = require('./domainViewService');
const clientService = require('../clients/clientService');
const { createProjectRecord } = require('../projects/projectService');
const {
  clientName, normalizeProfileInput, normalizeProjectInput, text, url,
} = require('../clients/clientFields');

/**
 * Connecting Namecheap domains and Leadzaro clients in both directions
 * (ADR 0009):
 *
 * - Namecheap → Leadzaro: the review queue lists synced domains no client
 *   uses yet, with Create client/project (a prefilled form — nothing is
 *   created until Save), Link to existing, and Ignore; plus conflicts and
 *   subdomain-only matches waiting for a decision.
 * - Leadzaro → Namecheap: lookupForForm checks a domain typed into a
 *   client/project form against the inventory (refreshing it within the
 *   rate budget when stale or unmatched) before anything is saved.
 *
 * Clients are never created automatically, and a Namecheap account holder
 * or registrant is never assumed to be the client's contact.
 */

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function getRecord(agencyOrganizationId, domainRecordId) {
  const record = await access.domainRecords.findOne(agencyOrganizationId, { where: { id: domainRecordId } });
  if (!record) throw invalid('Domain not found', 404);
  return record;
}

function brief(record, connection) {
  const facts = domainFacts(record, connection);
  return {
    id: record.id,
    domainName: record.domainName,
    displayName: facts.displayName,
    registrar: facts.registrar.value,
    expiresOn: facts.expiresOn.value,
    daysUntilExpiry: facts.daysUntilExpiry,
    autoRenew: facts.autoRenew.value,
    isPremium: facts.providerStatus?.isPremium ?? null,
    isExpired: facts.providerStatus?.isExpired ?? null,
    inConnectedAccount: facts.inConnectedAccount,
    missingSince: record.providerMissingSince,
    checkedAt: record.providerCheckedAt,
    stale: facts.sync.stale,
  };
}

function suggestionsFor(record, clients, projects) {
  const scored = [];
  for (const client of clients) {
    const score = nameResemblance(client.name, record.domainName);
    if (score) scored.push({ clientId: client.id, clientName: client.name, projectId: null, projectName: null, strength: score });
  }
  // Projects only on an exact match (names like "Website" are too generic),
  // and not when their client is already suggested.
  const suggestedClients = new Set(scored.map((s) => s.clientId));
  for (const project of projects) {
    if (!project.name || suggestedClients.has(project.organizationId)) continue;
    const score = nameResemblance(project.name, record.domainName);
    if (score === 2) {
      const client = clients.find((c) => c.id === project.organizationId);
      if (client) scored.push({ clientId: client.id, clientName: client.name, projectId: project.id, projectName: project.name, strength: score });
    }
  }
  return scored.sort((a, b) => b.strength - a.strength).slice(0, 3);
}

async function reviewQueue(context) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const [connection, records, links, clients, projects] = await Promise.all([
    connectionService.getConnection(agencyOrganizationId),
    access.domainRecords.findAll(agencyOrganizationId, { order: [['domainName', 'ASC']] }),
    access.domainLinks.findAll(agencyOrganizationId, {}),
    listClientOrganizationsForRequester(context),
    listProjectsForRequester(context, {}),
  ]);
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const projectNames = new Map(projects.map((project) => [project.id, project.name || clientNames.get(project.organizationId) || 'Project']));
  const linkBrief = (link) => ({
    id: link.id,
    clientId: link.organizationId,
    clientName: clientNames.get(link.organizationId) || 'Client',
    projectId: link.projectId,
    projectName: link.projectId ? projectNames.get(link.projectId) || 'Project' : null,
    hostname: link.hostname,
    override: link.linkOverride,
  });

  const queue = {
    unlinked: [], conflicts: [], reviews: [], notFound: [], missing: [], ignored: [],
  };
  for (const record of records) {
    const recordLinks = links.filter((link) => link.domainRecordId === record.id);
    const ownership = recordOwnership(record, recordLinks);
    const backed = isProviderBacked(record);
    if (backed && ownership.status === 'unlinked') {
      if (record.providerMissingSince) continue;
      if (record.ignoredAt) queue.ignored.push({ ...brief(record, connection), ignoredAt: record.ignoredAt });
      else {
        queue.unlinked.push({
          ...brief(record, connection), suggestedClientName: suggestClientName(record.domainName), suggestions: suggestionsFor(record, clients, projects),
        });
      }
      continue;
    }
    if (ownership.status === 'conflict') {
      queue.conflicts.push({ ...brief(record, connection), links: recordLinks.filter((link) => link.linkOverride !== 'rejected').map(linkBrief) });
      continue;
    }
    if (backed && ownership.status === 'review') {
      queue.reviews.push({ ...brief(record, connection), links: recordLinks.filter((link) => link.linkOverride !== 'rejected').map(linkBrief) });
      continue;
    }
    if (backed && record.providerMissingSince && ownership.status === 'linked') {
      queue.missing.push({ ...brief(record, connection), links: recordLinks.filter((link) => link.linkOverride !== 'rejected').map(linkBrief) });
      continue;
    }
    if (!backed && connection?.credentialsCiphertext) {
      for (const link of recordLinks) {
        const state = linkState(link, record, recordLinks, connection);
        if (state.state === 'not_found') queue.notFound.push({ ...brief(record, connection), link: linkBrief(link) });
      }
    }
  }
  return {
    connection: connectionSummary(connection),
    counts: Object.fromEntries(Object.entries(queue).map(([key, items]) => [key, items.length])),
    ...queue,
  };
}

async function setIgnored(context, domainRecordId, ignored, actorUserId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const record = await getRecord(agencyOrganizationId, domainRecordId);
  await record.update(ignored ? { ignoredAt: new Date(), ignoredByUserId: actorUserId } : { ignoredAt: null, ignoredByUserId: null });
  return { id: record.id, ignoredAt: record.ignoredAt };
}

async function resolveTarget(context, clientId, projectId) {
  const client = await getClientOrganizationForRequester(context, clientId);
  if (!client) throw invalid('Client not found', 404);
  if (projectId) {
    const [project] = await listProjectsForRequester(context, { id: projectId, organizationId: client.id });
    if (!project) throw invalid('That project does not belong to this client', 404);
  }
  return client;
}

/** "Link to existing client/project": an explicit, confirmed link. */
async function linkToClient(context, domainRecordId, { clientId, projectId = null }, actorUserId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const record = await getRecord(agencyOrganizationId, domainRecordId);
  const client = await resolveTarget(context, clientId, projectId);
  const confirmedElsewhere = await access.domainLinks.findOne(agencyOrganizationId, { where: { domainRecordId: record.id, linkOverride: 'confirmed' } });
  if (confirmedElsewhere && confirmedElsewhere.organizationId !== client.id) {
    throw invalid('This domain is already confirmed for another client. Unlink it there first.', 409);
  }
  const link = await sequelize.transaction(async (transaction) => {
    const scope = { organizationId: client.id, projectId: projectId || null };
    let domainLink = await access.domainLinks.findOne(agencyOrganizationId, { where: { ...scope, domainRecordId: record.id }, transaction });
    const override = { linkOverride: 'confirmed', overrideAt: new Date(), overrideByUserId: actorUserId };
    if (domainLink) await domainLink.update(override, { transaction });
    else {
      const hasPrimary = await access.domainLinks.count(agencyOrganizationId, { where: { ...scope, isPrimary: true }, transaction });
      domainLink = await ClientDomainLink.create({
        agencyOrganizationId, ...scope, domainRecordId: record.id, hostname: record.domainName, source: 'namecheap_link', isPrimary: hasPrimary === 0, createdByUserId: actorUserId, ...override,
      }, { transaction });
    }
    if (record.ignoredAt) await record.update({ ignoredAt: null, ignoredByUserId: null }, { transaction });
    return domainLink;
  });
  runInBackground('domain details', () => syncService.enrichLinkedDomain(agencyOrganizationId, record.domainName));
  return domainLinkService.describeLink(agencyOrganizationId, link);
}

function normalizeContact(input) {
  if (!input) return null;
  const fields = {
    name: text('Contact name', input.name, 150), email: text('Contact email', input.email, 255), phone: text('Contact phone', input.phone, 50),
  };
  if (!fields.name && !fields.email && !fields.phone) return null;
  if (!fields.name) throw invalid('Add the contact’s name, or leave the contact fields empty');
  return fields;
}

/**
 * "Create client/project" from an unlinked domain: validated first, then
 * the client, its profile, an optional first project, an optional primary
 * contact and the confirmed domain link are created in one transaction —
 * all or nothing, and only when the person clicks Save.
 */
async function createClientFromDomain(context, domainRecordId, input, actorUserId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const record = await getRecord(agencyOrganizationId, domainRecordId);
  const existingLinks = await access.domainLinks.findAll(agencyOrganizationId, { where: { domainRecordId: record.id } });
  if (existingLinks.some((link) => link.linkOverride !== 'rejected')) throw invalid('This domain is already linked to a client.', 409);

  const body = input || {};
  const name = clientName(body.client?.name);
  await clientService.assertNameAvailable(context, name);
  const websiteUrl = url('Website', body.client?.websiteUrl ?? `https://${record.domainName}`);
  const profileFields = normalizeProfileInput({ ...(body.billing || {}), websiteUrl });
  const wantsProject = body.project !== null && body.project !== false;
  const projectFields = wantsProject
    ? normalizeProjectInput({
      name: body.project?.name ?? 'Website', projectType: body.project?.projectType ?? 'website', liveUrl: body.project?.liveUrl ?? websiteUrl,
    }, { requireName: true })
    : null;
  const contactFields = normalizeContact(body.contact);

  const created = await sequelize.transaction(async (transaction) => {
    const organization = await clientService.createClientWithin(context, { name, profileFields }, transaction);
    const project = projectFields
      ? await createProjectRecord({
        ...projectFields, organizationId: organization.id, agencyOrganizationId, ownerUserId: actorUserId,
      }, { transaction })
      : null;
    if (contactFields) {
      await Contact.create({
        ...contactFields, isPrimary: true, organizationId: organization.id, agencyOrganizationId, source: 'manual',
      }, { transaction });
    }
    const linkArgs = {
      agencyOrganizationId, organizationId: organization.id, actorUserId, transaction,
    };
    await domainLinkService.reconcileDerivedLink({ ...linkArgs, source: 'client_website', url: websiteUrl });
    if (project) await domainLinkService.reconcileDerivedLink({ ...linkArgs, projectId: project.id, source: 'project_url', url: projectFields.liveUrl });

    const scope = { organizationId: organization.id, projectId: project ? project.id : null };
    const override = { linkOverride: 'confirmed', overrideAt: new Date(), overrideByUserId: actorUserId };
    let link = await access.domainLinks.findOne(agencyOrganizationId, { where: { ...scope, domainRecordId: record.id }, transaction });
    if (link) await link.update(override, { transaction });
    else {
      const hasPrimary = await access.domainLinks.count(agencyOrganizationId, { where: { ...scope, isPrimary: true }, transaction });
      link = await ClientDomainLink.create({
        agencyOrganizationId, ...scope, domainRecordId: record.id, hostname: record.domainName, source: 'namecheap_link', isPrimary: hasPrimary === 0, createdByUserId: actorUserId, ...override,
      }, { transaction });
    }
    if (record.ignoredAt) await record.update({ ignoredAt: null, ignoredByUserId: null }, { transaction });
    return { organization, project, link };
  });

  runInBackground('domain details', () => syncService.enrichLinkedDomain(agencyOrganizationId, record.domainName));
  return {
    client: { id: created.organization.id, name: created.organization.name },
    project: created.project ? { id: created.project.id, name: created.project.name } : null,
    domainMatch: await domainLinkService.describeLink(agencyOrganizationId, created.link),
  };
}

const LOOKUP_LABELS = {
  matched: 'Matched in Namecheap',
  missing: 'Not found in connected account',
  not_found: 'Not found in connected account',
  not_connected: 'Namecheap isn’t connected — details can be entered by hand',
  check_failed: 'Couldn’t check Namecheap right now — it will be retried',
  platform: 'Platform address — nothing to register',
  invalid: 'Not a website address',
};

/** Checks a domain typed into a client/project form before it is saved. Never creates a client or link. */
async function lookupForForm(context, { url: input, clientId = null }) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const { parsed, error } = domainLinkService.trackableDomain(input);
  if (error) {
    const state = parsed?.ok && parsed.platformSuffix ? 'platform' : 'invalid';
    return {
      state, label: LOOKUP_LABELS[state], message: error, hostname: parsed?.hostname || null,
    };
  }
  const domainName = parsed.registrableDomain;
  const connection = await connectionService.getConnection(agencyOrganizationId);
  let record = await access.domainRecords.findOne(agencyOrganizationId, { where: { domainName } });
  let check = null;
  if (syncService.needsProviderCheck(record, connection)) {
    check = await syncService.checkDomain({ agencyOrganizationId, domainName });
    record = await access.domainRecords.findOne(agencyOrganizationId, { where: { domainName } });
  }

  let state;
  if (!connection?.credentialsCiphertext) state = 'not_connected';
  else if (record && isProviderBacked(record) && !record.providerMissingSince) state = 'matched';
  else if (record?.providerMissingSince) state = 'missing';
  else if (check && !check.checked) state = 'check_failed';
  else state = 'not_found';

  const links = record ? await access.domainLinks.findAll(agencyOrganizationId, { where: { domainRecordId: record.id } }) : [];
  const elsewhere = links.filter((link) => link.linkOverride !== 'rejected' && link.organizationId !== clientId);
  const names = elsewhere.length ? await listClientOrganizationsForRequester(context) : [];
  const linkedElsewhere = [...new Set(elsewhere.map((link) => link.organizationId))].map((id) => ({
    clientId: id, clientName: names.find((client) => client.id === id)?.name || 'Another client',
  }));

  return {
    state,
    label: LOOKUP_LABELS[state],
    domainName,
    displayName: displayDomain(domainName),
    hostname: parsed.hostname,
    subdomain: parsed.subdomain || null,
    preview: record && ['matched', 'missing'].includes(state) ? brief(record, connection) : null,
    linkedElsewhere,
    checkError: check && !check.checked ? (check.error?.message || check.message || null) : null,
    connection: connectionSummary(connection),
  };
}

/** "Check again": looks this one domain up now (within the rate budget), then reports its state. */
async function checkAgain(context, domainRecordId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const record = await getRecord(agencyOrganizationId, domainRecordId);
  const check = await syncService.checkDomain({ agencyOrganizationId, domainName: record.domainName, force: true });
  await access.reload(record);
  if (check.checked && check.found) runInBackground('domain details', () => syncService.enrichLinkedDomain(agencyOrganizationId, record.domainName));
  const connection = await connectionService.getConnection(agencyOrganizationId);
  return {
    check, domain: brief(record, connection), label: check.checked ? LINK_STATE_LABELS[check.found ? 'linked' : 'not_found'] : LOOKUP_LABELS.check_failed,
  };
}

module.exports = {
  reviewQueue,
  setIgnored,
  linkToClient,
  createClientFromDomain,
  lookupForForm,
  checkAgain,
  getRecord,
  resolveTarget,
};

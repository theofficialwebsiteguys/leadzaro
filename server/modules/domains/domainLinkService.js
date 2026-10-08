'use strict';

const { sequelize, ClientDomainLink } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const { parseDomainInput } = require('../../core/domains/domainName');
const {
  linkState, domainFacts, LINK_STATE_LABELS, isProviderBacked,
} = require('../../core/domains/domainFacts');
const { runInBackground, withTimeout } = require('../../core/jobs/background');
const connectionService = require('../integrations/namecheapConnectionService');
const syncService = require('../integrations/namecheapSyncService');

/**
 * Which client/project uses which domain (ADR 0009).
 *
 * Links derived from a website URL (the client's website, a project's
 * live URL) follow that URL: when it changes to another domain, the old
 * link — and any link/unlink decision made about it — is dropped, so
 * nothing from the previous domain carries over. Manual links and links
 * made from the review list are only changed by a person.
 */

const POST_SAVE_CHECK_TIMEOUT_MS = 12000;

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function scopeWhere(organizationId, projectId) {
  return { organizationId, projectId: projectId || null };
}

async function ensurePrimary(agencyOrganizationId, organizationId, projectId, transaction) {
  const links = await access.domainLinks.findAll(agencyOrganizationId, { where: scopeWhere(organizationId, projectId), order: [['createdAt', 'ASC']], transaction });
  if (!links.length || links.some((link) => link.isPrimary)) return;
  await links[0].update({ isPrimary: true }, { transaction });
}

/** A placeholder we created that holds nothing (no provider data, no manual entries, no links, no payments) is removed. */
async function removeIfEmptyPlaceholder(agencyOrganizationId, domainRecordId, transaction) {
  const record = await access.domainRecords.findOne(agencyOrganizationId, { where: { id: domainRecordId }, transaction });
  if (!record || isProviderBacked(record) || record.manualUpdatedAt || record.registrarName || record.notes) return;
  const [remainingLinks, payments] = await Promise.all([
    access.domainLinks.count(agencyOrganizationId, { where: { domainRecordId }, transaction }),
    access.expenses.count(agencyOrganizationId, { where: { domainRecordId }, transaction }),
  ]);
  if (remainingLinks === 0 && payments === 0) await record.destroy({ transaction });
}

function trackableDomain(input) {
  const parsed = parseDomainInput(input);
  if (!parsed.ok) return { parsed, error: parsed.message };
  if (parsed.platformSuffix) return { parsed, error: `${parsed.displayHostname} is a ${parsed.platformSuffix} address — there is no domain of the client’s own to register or renew.` };
  return { parsed };
}

async function reconcileDerivedLink({
  agencyOrganizationId, organizationId, projectId = null, source, url, actorUserId = null, transaction,
}) {
  const scope = scopeWhere(organizationId, projectId);
  const existing = await access.domainLinks.findOne(agencyOrganizationId, { where: { ...scope, source }, transaction });
  const { parsed, error } = url ? trackableDomain(url) : { parsed: null, error: 'empty' };

  if (error) {
    if (existing) {
      await existing.destroy({ transaction });
      await ensurePrimary(agencyOrganizationId, organizationId, projectId, transaction);
      await removeIfEmptyPlaceholder(agencyOrganizationId, existing.domainRecordId, transaction);
    }
    return { link: null, record: null, parsed };
  }

  const record = await access.findOrCreateDomainRecord(agencyOrganizationId, parsed.registrableDomain, { transaction });
  if (existing && existing.domainRecordId === record.id) {
    if (existing.hostname !== parsed.hostname) await existing.update({ hostname: parsed.hostname }, { transaction });
    return { link: existing, record, parsed };
  }
  if (existing) {
    await existing.destroy({ transaction });
    await removeIfEmptyPlaceholder(agencyOrganizationId, existing.domainRecordId, transaction);
  }

  const sameScope = await access.domainLinks.findOne(agencyOrganizationId, { where: { ...scope, domainRecordId: record.id }, transaction });
  if (sameScope) {
    await ensurePrimary(agencyOrganizationId, organizationId, projectId, transaction);
    return { link: sameScope, record, parsed };
  }
  const hasPrimary = await access.domainLinks.count(agencyOrganizationId, { where: { ...scope, isPrimary: true }, transaction });
  const link = await ClientDomainLink.create({
    agencyOrganizationId,
    organizationId,
    projectId,
    domainRecordId: record.id,
    hostname: parsed.hostname,
    source,
    isPrimary: hasPrimary === 0,
    createdByUserId: actorUserId,
  }, { transaction });
  return { link, record, parsed };
}

function previewOf(facts) {
  return {
    registrar: facts.registrar.value,
    expiresOn: facts.expiresOn.value,
    daysUntilExpiry: facts.daysUntilExpiry,
    autoRenew: facts.autoRenew.value,
    isPremium: facts.providerStatus?.isPremium ?? null,
    isExpired: facts.providerStatus?.isExpired ?? null,
  };
}

/** The state a saved link ended up in, for the form to show ("Matched in Namecheap", "Not found…", conflict). */
async function describeLink(agencyOrganizationId, link) {
  const [record, connection] = await Promise.all([
    access.domainRecords.findOne(agencyOrganizationId, { where: { id: link.domainRecordId } }),
    connectionService.getConnection(agencyOrganizationId),
  ]);
  const allLinks = await access.domainLinks.findAll(agencyOrganizationId, { where: { domainRecordId: record.id } });
  const state = linkState(link, record, allLinks, connection);
  const facts = domainFacts(record, connection);
  return {
    state: state.state,
    label: LINK_STATE_LABELS[state.state],
    domainName: record.domainName,
    displayName: facts.displayName,
    hostname: link.hostname,
    linkId: link.id,
    otherClientIds: state.otherOrganizationIds || [],
    preview: ['linked', 'missing', 'conflict', 'review'].includes(state.state) ? previewOf(facts) : null,
  };
}

/**
 * After a link is created or changes domain: check the connected account
 * when the inventory is stale or has no match (one rate-limited call,
 * bounded wait — it finishes in the background if slow), then fill in
 * nameservers/estimates for a match without holding up the response.
 */
async function matchAfterSave(agencyOrganizationId, link, record) {
  const connection = await connectionService.getConnection(agencyOrganizationId);
  if (syncService.needsProviderCheck(record, connection)) {
    const check = runInBackground('domain check', () => syncService.checkDomain({ agencyOrganizationId, domainName: record.domainName }));
    await withTimeout(check, POST_SAVE_CHECK_TIMEOUT_MS, null);
  }
  const described = await describeLink(agencyOrganizationId, link);
  if (described.state === 'linked') {
    runInBackground('domain details', () => syncService.enrichLinkedDomain(agencyOrganizationId, record.domainName));
  }
  return described;
}

/** Called after a client's website URL or a project's live URL is saved. */
async function syncUrlLink({
  agencyOrganizationId, organizationId, projectId = null, url, actorUserId,
}) {
  const source = projectId ? 'project_url' : 'client_website';
  const { link, record, parsed } = await sequelize.transaction((transaction) => reconcileDerivedLink({
    agencyOrganizationId, organizationId, projectId, source, url, actorUserId, transaction,
  }));
  if (!link) {
    if (parsed?.ok && parsed.platformSuffix) {
      return {
        state: 'platform', label: 'Platform address — nothing to register', domainName: null, hostname: parsed.hostname, platformSuffix: parsed.platformSuffix,
      };
    }
    return null;
  }
  return matchAfterSave(agencyOrganizationId, link, record);
}

async function addManualLink({
  agencyOrganizationId, organizationId, projectId = null, domain, isPrimary = false, actorUserId,
}) {
  const { parsed, error } = trackableDomain(domain);
  if (error) throw invalid(error);
  const scope = scopeWhere(organizationId, projectId);
  const { link, record } = await sequelize.transaction(async (transaction) => {
    const domainRecord = await access.findOrCreateDomainRecord(agencyOrganizationId, parsed.registrableDomain, { transaction });
    let domainLink = await access.domainLinks.findOne(agencyOrganizationId, { where: { ...scope, domainRecordId: domainRecord.id }, transaction });
    if (domainLink) {
      if (domainLink.linkOverride === 'rejected') await domainLink.update({ linkOverride: null, overrideAt: new Date(), overrideByUserId: actorUserId }, { transaction });
    } else {
      domainLink = await ClientDomainLink.create({
        agencyOrganizationId, ...scope, domainRecordId: domainRecord.id, hostname: parsed.hostname, source: 'manual', createdByUserId: actorUserId,
      }, { transaction });
    }
    if (isPrimary) await setPrimaryWithin(agencyOrganizationId, domainLink, transaction);
    else await ensurePrimary(agencyOrganizationId, organizationId, projectId, transaction);
    return { link: domainLink, record: domainRecord };
  });
  return matchAfterSave(agencyOrganizationId, link, record);
}

async function setPrimaryWithin(agencyOrganizationId, link, transaction) {
  const siblings = await access.domainLinks.findAll(agencyOrganizationId, { where: { ...scopeWhere(link.organizationId, link.projectId), isPrimary: true }, transaction });
  for (const sibling of siblings) {
    // eslint-disable-next-line no-await-in-loop
    if (sibling.id !== link.id) await sibling.update({ isPrimary: false }, { transaction });
  }
  await link.update({ isPrimary: true }, { transaction });
}

/**
 * An explicit decision about a link: 'confirm' (this client owns this
 * domain — wins over automatic matching), 'reject' (unlink: keep the
 * domain on the project but show only manual details), or 'automatic'
 * (forget the decision). Confirming is refused while another client holds
 * a confirmed link, so a domain is never confirmed for two clients.
 */
async function decideLink({
  agencyOrganizationId, link, decision, actorUserId,
}) {
  const override = { confirm: 'confirmed', reject: 'rejected', automatic: null }[decision];
  if (override === undefined) throw invalid('Decision must be confirm, reject or automatic');
  if (override === 'confirmed') {
    const confirmedElsewhere = await access.domainLinks.findOne(agencyOrganizationId, {
      where: { domainRecordId: link.domainRecordId, linkOverride: 'confirmed' },
    });
    if (confirmedElsewhere && confirmedElsewhere.organizationId !== link.organizationId) {
      throw invalid('This domain is already confirmed for another client. Unlink it there first.', 409);
    }
  }
  await link.update({ linkOverride: override, overrideAt: new Date(), overrideByUserId: actorUserId });
  return describeLink(agencyOrganizationId, link);
}

async function setPrimary(agencyOrganizationId, link) {
  await sequelize.transaction((transaction) => setPrimaryWithin(agencyOrganizationId, link, transaction));
  return describeLink(agencyOrganizationId, link);
}

/** Moves a link between the client as a whole and one of its projects (project ownership checked by the caller). */
async function moveLink(agencyOrganizationId, link, projectId) {
  const target = projectId || null;
  if (target === link.projectId) return describeLink(agencyOrganizationId, link);
  const clash = await access.domainLinks.findOne(agencyOrganizationId, {
    where: { ...scopeWhere(link.organizationId, target), domainRecordId: link.domainRecordId },
  });
  if (clash) throw invalid('That project already has this domain.', 409);
  const previousProjectId = link.projectId;
  await sequelize.transaction(async (transaction) => {
    // A URL-derived link that is moved becomes a manual one: it no longer follows the URL it came from.
    await link.update({
      projectId: target, isPrimary: false, source: ['client_website', 'project_url'].includes(link.source) ? 'manual' : link.source,
    }, { transaction });
    await ensurePrimary(agencyOrganizationId, link.organizationId, previousProjectId, transaction);
    await ensurePrimary(agencyOrganizationId, link.organizationId, target, transaction);
  });
  return describeLink(agencyOrganizationId, link);
}

/** Removes a manual link. URL-derived links follow their URL — change or clear the URL instead (or unlink). */
async function removeLink(agencyOrganizationId, link) {
  if (['client_website', 'project_url'].includes(link.source)) {
    throw invalid(link.source === 'project_url'
      ? 'This domain comes from the project’s live URL. Change the URL to use a different domain, or unlink it to enter details manually.'
      : 'This domain comes from the client’s website address. Change the address to use a different domain, or unlink it to enter details manually.', 409);
  }
  await sequelize.transaction(async (transaction) => {
    await link.destroy({ transaction });
    await ensurePrimary(agencyOrganizationId, link.organizationId, link.projectId, transaction);
    await removeIfEmptyPlaceholder(agencyOrganizationId, link.domainRecordId, transaction);
  });
}

async function getOwnedLink(agencyOrganizationId, organizationId, linkId) {
  const link = await access.domainLinks.findOne(agencyOrganizationId, { where: { id: linkId, organizationId } });
  if (!link) throw invalid('Domain link not found', 404);
  return link;
}

module.exports = {
  trackableDomain,
  reconcileDerivedLink,
  syncUrlLink,
  addManualLink,
  decideLink,
  setPrimary,
  moveLink,
  removeLink,
  getOwnedLink,
  describeLink,
  matchAfterSave,
};

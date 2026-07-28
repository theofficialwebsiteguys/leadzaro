'use strict';

const {
  getWebsiteDomainForRequester, findOrCreateWebsiteDomainForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getNamecheapAdapter } = require('../../core/integrations/namecheap/namecheapAdapter');
const { getCPanelAdapter } = require('../../core/integrations/cpanel/cpanelAdapter');
const { getWebsite } = require('./websiteService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function getDomain(context, projectId) {
  const website = await getWebsite(context, projectId);
  return getWebsiteDomainForRequester(context, website.id);
}

async function checkAvailability(context, projectId, domain) {
  await getWebsite(context, projectId); // access check only
  const adapter = getNamecheapAdapter();
  return adapter.checkAvailability(domain);
}

/**
 * Registers a domain (current-phase-plan.md § 2a/2d) and creates its
 * WebsiteDomain row in one action. Idempotent the same way
 * provisionRepository is: a domain already 'active' is returned as-is,
 * never re-registered against the adapter a second time.
 */
async function registerDomain({
  context, projectId, domain, years, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const record = await findOrCreateWebsiteDomainForRequester(context, website, domain);
  if (record.status === 'active') return record;

  try {
    const adapter = getNamecheapAdapter();
    const registered = await adapter.registerDomain(domain, years || 1);
    await record.update({
      externalDomainId: registered.externalDomainId,
      registeredAt: registered.registeredAt,
      expiresAt: registered.expiresAt,
      status: 'active',
    });
    return record;
  } catch (err) {
    throw invalid(`Failed to register domain: ${err.message}`, 502);
  }
}

async function updateDnsRecords({
  context, projectId, records,
}) {
  const website = await getWebsite(context, projectId);
  const record = await getWebsiteDomainForRequester(context, website.id);
  if (!record) throw invalid('No domain registered for this website', 404);

  const adapter = getNamecheapAdapter();
  const result = await adapter.updateDnsRecords(record.domain, records);
  await record.update({ dnsRecords: result.dnsRecords });
  return record;
}

/**
 * A website's cPanel "account" is its own website id — a stable,
 * unique identifier the mock/live cPanel adapter can key a hosting
 * account by, reused identically by the production deploy pipeline
 * (slice 3) so document-root mapping and deployment upload always
 * agree on which hosting account they mean.
 */
function cpanelAccountForWebsite(website) {
  return website.id;
}

/**
 * Maps this website's registered domain to a document-root folder path
 * on its cPanel hosting account (current-phase-plan.md § 2a). Requires
 * a domain to already be registered — mapping a folder for a domain
 * that doesn't exist yet would be meaningless.
 */
async function mapDocumentRoot({ context, projectId, path }) {
  const website = await getWebsite(context, projectId);
  const record = await getWebsiteDomainForRequester(context, website.id);
  if (!record) throw invalid('No domain registered for this website', 404);

  const adapter = getCPanelAdapter();
  const account = cpanelAccountForWebsite(website);
  await adapter.mapDocumentRoot(account, record.domain, path);
  await record.update({ cpanelAccount: account, documentRootPath: path });
  return record;
}

module.exports = {
  getDomain, checkAvailability, registerDomain, updateDnsRecords, mapDocumentRoot, cpanelAccountForWebsite,
};

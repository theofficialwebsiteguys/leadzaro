'use strict';

const {
  getWebsiteDomainForRequester, findOrCreateWebsiteDomainForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getNamecheapAdapter } = require('../../core/integrations/namecheap/namecheapAdapter');
const { getCPanelAdapter } = require('../../core/integrations/cpanel/cpanelAdapter');
const { getWebsite } = require('./websiteService');
const { listAssignments } = require('../projects/projectService');
const { listForOrganization } = require('../memberships/membershipService');
const { notify } = require('../../core/notifications/notificationService');

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

// Same technical+management audience as productionDeployService's own
// notify loop (current-phase-plan.md § 2c) — a domain lapsing is just
// as much a "responsible roles must not be surprised" event as a
// failed production deploy (architecture § 21).
const NOTIFIED_EMPLOYEE_ROLE_SLOTS = new Set(['owner', 'project_manager', 'developer', 'advanced_designer']);
const RENEWAL_NOTICE_WINDOW_DAYS = 30;
const RENEWAL_NOTICE_COOLDOWN_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Domain renewal tracking (current-phase-plan.md § 5, slice 8). No
 * background job scheduler exists in this codebase yet (the same
 * limitation notificationService.js's own digest-delivery comment
 * already documents) — this is an explicit, employee-triggered check
 * rather than an automatic cron, consistent with that established
 * scope boundary. Idempotent within RENEWAL_NOTICE_COOLDOWN_DAYS so
 * repeated manual checks (or a future scheduler calling this same
 * function) never spam either audience.
 *
 * Employee notification carries the full detail (domain, provider,
 * autoRenew); the client-facing notification is deliberately narrow —
 * domain name and renewal date only, never DNS/registrar internals —
 * the same "notify without exposing the row" pattern § 2d already
 * established for WebsiteDomain's employee-only visibility.
 */
async function checkRenewal({ context, projectId }) {
  const website = await getWebsite(context, projectId);
  const record = await getWebsiteDomainForRequester(context, website.id);
  if (!record?.expiresAt) return { noticeSent: false, reason: 'no_domain_or_expiry' };

  const now = new Date();
  const daysUntilExpiry = (record.expiresAt.getTime() - now.getTime()) / MS_PER_DAY;
  if (daysUntilExpiry > RENEWAL_NOTICE_WINDOW_DAYS) return { noticeSent: false, reason: 'not_yet_due', daysUntilExpiry };

  if (record.renewalNoticeSentAt) {
    const daysSinceLastNotice = (now.getTime() - record.renewalNoticeSentAt.getTime()) / MS_PER_DAY;
    if (daysSinceLastNotice < RENEWAL_NOTICE_COOLDOWN_DAYS) {
      return {
        noticeSent: false, reason: 'already_sent_recently', daysUntilExpiry,
      };
    }
  }

  const roundedDays = Math.max(0, Math.ceil(daysUntilExpiry));

  const assignments = await listAssignments(context, projectId);
  const employeeUserIds = new Set(
    assignments.filter((assignment) => NOTIFIED_EMPLOYEE_ROLE_SLOTS.has(assignment.roleSlot)).map((assignment) => assignment.userId)
  );
  for (const userId of employeeUserIds) {
    await notify({
      userId,
      organizationId: website.agencyOrganizationId,
      type: 'website_domain_renewal_approaching',
      title: `Domain ${record.domain} renews in ${roundedDays} day(s)`,
      body: `Registered via ${record.provider}. autoRenew: ${record.autoRenew}.`,
      data: {
        websiteId: website.id, domain: record.domain, expiresAt: record.expiresAt, projectId,
      },
    });
  }

  const clientMemberships = await listForOrganization(website.organizationId);
  const activeClientUserIds = clientMemberships.filter((m) => m.status === 'active').map((m) => m.userId);
  for (const userId of activeClientUserIds) {
    await notify({
      userId,
      organizationId: website.organizationId,
      type: 'website_domain_renewal_approaching',
      title: `Your domain ${record.domain} renews soon`,
      body: `Renews on ${record.expiresAt.toISOString().slice(0, 10)}.`,
      data: { domain: record.domain, expiresAt: record.expiresAt },
    });
  }

  await record.update({ renewalNoticeSentAt: now });
  return {
    noticeSent: true,
    daysUntilExpiry,
    notifiedEmployeeUserIds: [...employeeUserIds],
    notifiedClientUserIds: activeClientUserIds,
  };
}

module.exports = {
  getDomain, checkAvailability, registerDomain, updateDnsRecords, mapDocumentRoot, cpanelAccountForWebsite, checkRenewal,
};

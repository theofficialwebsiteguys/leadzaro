'use strict';

const { Op, QueryTypes } = require('sequelize');
const { sequelize } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const { parseDomainInput } = require('../../core/domains/domainName');
const { RegistrarError, PAGE_SIZE, MAX_PAGES } = require('../../core/integrations/namecheap/namecheapRegistrarReader');
const connectionService = require('./namecheapConnectionService');

/**
 * Pulls the connected Namecheap account into the domain registry
 * (ADR 0009). Safe to repeat: domains are upserted by (workspace, name),
 * so nothing is ever duplicated, and only provider* / estimated* columns
 * are written — manual entries and overrides are never touched.
 *
 * Failure rules:
 * - nothing is ever deleted;
 * - a domain is marked "not found in connected account" only after a
 *   *complete* domain listing omits it — never because a sync failed or
 *   a page could not be read — and its last known details are kept;
 * - an expiration date is never inferred; it is only what Namecheap
 *   reported (or what someone entered);
 * - a failed step (nameservers, prices, SSL) leaves that step's previous
 *   data in place, and the sync reports "partial".
 */

const NAMESERVER_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const NAMESERVER_BATCH = 40;
const PRICE_REFRESH_MS = 24 * 60 * 60 * 1000;
const RECENT_CHECK_MS = 10 * 60 * 1000;
const FORCED_CHECK_COOLDOWN_MS = 30 * 1000;
const INVENTORY_FRESH_MS = 24 * 60 * 60 * 1000;

const recentChecks = new Map();

function safeError(err) {
  if (err instanceof RegistrarError) return err.toJSON();
  return { kind: 'unexpected', message: 'Unexpected error while syncing.' };
}

function keep(next, previous) {
  return next === null || next === undefined ? previous : next;
}

/** Provider columns only. Dates the API sent unreadably keep their previous value rather than being blanked. */
function providerFieldsFrom(listed, connection, now, record) {
  const premiumChanged = record.providerIsPremium !== null && listed.isPremium !== null && record.providerIsPremium !== listed.isPremium;
  return {
    providerKey: 'namecheap',
    providerConnectionId: connection.id,
    providerAccountKey: connectionService.accountKeyFor(connection),
    providerDomainId: listed.providerDomainId || record.providerDomainId,
    providerCreatedOn: keep(listed.createdOn, record.providerCreatedOn),
    providerExpiresOn: keep(listed.expiresOn, record.providerExpiresOn),
    providerIsExpired: listed.isExpired,
    providerIsLocked: listed.isLocked,
    providerAutoRenew: listed.autoRenew,
    providerIsPremium: listed.isPremium,
    providerUsesNamecheapDns: keep(listed.usesNamecheapDns, record.providerUsesNamecheapDns),
    providerPrivacy: listed.privacy,
    providerFirstSeenAt: record.providerFirstSeenAt || now,
    providerLastSeenAt: now,
    providerCheckedAt: now,
    providerMissingSince: null,
    ...(premiumChanged ? { estimatedRenewalFetchedAt: null } : {}),
  };
}

async function applyListedDomain(agencyOrganizationId, listed, connection, now) {
  const record = await access.findOrCreateDomainRecord(agencyOrganizationId, listed.domainName);
  const isNew = !record.providerLastSeenAt;
  await record.update(providerFieldsFrom(listed, connection, now, record));
  return { record, isNew };
}

// ─── Estimates ─────────────────────────────────────────────────────────

const PREMIUM_NOTE = 'Premium domain — Namecheap prices premium renewals per domain, not from the standard price list. Enter the renewal amount manually if you know it.';

function estimateFromPrices(prices, tld) {
  const oneYear = prices.find((price) => price.years === 1);
  const base = oneYear ? (oneYear.yourPriceCents ?? oneYear.priceCents) : null;
  if (base === null || base === undefined) {
    return { estimatedRenewalCents: null, estimatedRenewalCurrency: null, estimatedRenewalYears: null, estimatedRenewalNote: `Namecheap returned no 1-year renewal price for .${tld}.` };
  }
  const fee = oneYear.additionalCents || 0;
  const feeNote = fee ? ` Includes a ${(fee / 100).toFixed(2)} ${oneYear.currency || 'USD'} registry/ICANN fee.` : '';
  return {
    estimatedRenewalCents: base + fee,
    estimatedRenewalCurrency: oneYear.currency || 'USD',
    estimatedRenewalYears: 1,
    estimatedRenewalNote: `Estimate: Namecheap’s current 1-year .${tld} renewal price for your account.${feeNote} Taxes and any other fees at checkout are not included.`,
  };
}

/** Applies one TLD's price list to every Namecheap-registered domain on it; premium names get "unknown", not the standard price. */
async function applyEstimates(records, tld, prices, now) {
  const estimate = estimateFromPrices(prices, tld);
  for (const record of records) {
    const values = record.providerIsPremium
      ? {
        estimatedRenewalCents: null, estimatedRenewalCurrency: null, estimatedRenewalYears: null, estimatedRenewalNote: PREMIUM_NOTE,
      }
      : estimate;
    // eslint-disable-next-line no-await-in-loop
    await record.update({ ...values, estimatedRenewalFetchedAt: now });
  }
}

function tldOf(domainName) {
  const parsed = parseDomainInput(domainName);
  return parsed.ok ? parsed.publicSuffix : null;
}

// ─── Full sync ─────────────────────────────────────────────────────────

async function acquireLock(agencyOrganizationId, trigger, now) {
  const rows = await sequelize.query(
    `UPDATE "IntegrationConnections"
        SET "syncLockedUntil" = :until, "lastSyncStartedAt" = :now, "lastSyncStatus" = 'running', "lastSyncTrigger" = :trigger, "updatedAt" = :now
      WHERE "agencyOrganizationId" = :agencyOrganizationId AND provider = 'namecheap' AND "credentialsCiphertext" IS NOT NULL
        AND ("syncLockedUntil" IS NULL OR "syncLockedUntil" < :now)
      RETURNING id`,
    {
      replacements: {
        agencyOrganizationId, trigger, now, until: new Date(now.getTime() + connectionService.SYNC_LOCK_MS),
      },
      type: QueryTypes.SELECT,
    },
  );
  return rows.length > 0;
}

async function syncDomainList(agencyOrganizationId, reader, connection, now, summary) {
  const seen = new Set();
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await reader.listDomainsPage(page);
    } catch (err) {
      if (page === 1) throw err;
      summary.errors.push({ step: 'domains', page, ...safeError(err) });
      break;
    }
    for (const listed of result.domains) {
      if (!listed.domainName) {
        summary.errors.push({ step: 'domains', kind: 'unreadable_entry', message: `Skipped a domain entry Leadzaro could not read (${String(listed.reportedName || 'no name').slice(0, 80)}).` });
        continue;
      }
      if (seen.has(listed.domainName)) continue;
      seen.add(listed.domainName);
      // eslint-disable-next-line no-await-in-loop
      const { isNew } = await applyListedDomain(agencyOrganizationId, listed, connection, now);
      summary.domainsSeen += 1;
      if (isNew) summary.domainsAdded += 1;
    }
    const total = result.totalItems;
    if (result.domains.length < PAGE_SIZE || (total !== null && page * PAGE_SIZE >= total)) {
      complete = true;
      break;
    }
  }
  if (!complete) summary.errors.push({ step: 'domains', kind: 'incomplete', message: 'The domain list could not be read completely, so no domain was marked as missing this time.' });
  return { seen, complete };
}

/** Only after a complete listing: domains it no longer contains are "not found in connected account" (kept, never deleted). */
async function markMissing(agencyOrganizationId, seen, now, summary) {
  const where = {
    providerKey: 'namecheap', providerLastSeenAt: { [Op.ne]: null }, providerMissingSince: null,
  };
  if (seen.size) where.domainName = { [Op.notIn]: [...seen] };
  const missing = await access.domainRecords.findAll(agencyOrganizationId, { where });
  for (const record of missing) {
    // eslint-disable-next-line no-await-in-loop
    await record.update({ providerMissingSince: now });
  }
  summary.markedMissing = missing.length;
}

async function linkedDomainNames(agencyOrganizationId) {
  const links = await access.domainLinks.findAll(agencyOrganizationId, { where: { linkOverride: { [Op.or]: [null, 'confirmed'] } }, attributes: ['domainRecordId'] });
  return new Set(links.map((link) => link.domainRecordId));
}

async function syncNameservers(agencyOrganizationId, reader, now, summary) {
  const linkedIds = await linkedDomainNames(agencyOrganizationId);
  if (!linkedIds.size) return;
  const candidates = await access.domainRecords.findAll(agencyOrganizationId, {
    where: {
      id: [...linkedIds],
      providerKey: 'namecheap',
      providerMissingSince: null,
      [Op.or]: [{ providerNameserversSyncedAt: null }, { providerNameserversSyncedAt: { [Op.lt]: new Date(now.getTime() - NAMESERVER_REFRESH_MS) } }],
    },
    order: [['providerNameserversSyncedAt', 'ASC NULLS FIRST']],
    limit: NAMESERVER_BATCH,
  });
  for (const record of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const dns = await reader.getNameservers(record.domainName);
      // eslint-disable-next-line no-await-in-loop
      await record.update({
        providerNameservers: dns.nameservers,
        providerUsesNamecheapDns: keep(dns.usesNamecheapDns, record.providerUsesNamecheapDns),
        providerNameserversSyncedAt: now,
        providerNameserversError: null,
      });
      summary.nameserversFetched += 1;
    } catch (err) {
      if (err instanceof RegistrarError && ['not_in_account', 'invalid_domain'].includes(err.kind)) {
        // eslint-disable-next-line no-await-in-loop
        await record.update({ providerNameserversError: err.message.slice(0, 300), providerNameserversSyncedAt: now });
        continue;
      }
      summary.errors.push({ step: 'nameservers', domain: record.domainName, ...safeError(err) });
      if (err instanceof RegistrarError && ['budget_exhausted', 'rate_limited'].includes(err.kind)) break;
    }
  }
}

async function syncPrices(agencyOrganizationId, reader, now, summary) {
  const records = await access.domainRecords.findAll(agencyOrganizationId, {
    where: { providerKey: 'namecheap', providerMissingSince: null, providerLastSeenAt: { [Op.ne]: null } },
  });
  const byTld = new Map();
  for (const record of records) {
    const tld = tldOf(record.domainName);
    if (!tld) continue;
    if (!byTld.has(tld)) byTld.set(tld, []);
    byTld.get(tld).push(record);
  }
  for (const [tld, tldRecords] of byTld) {
    const stale = tldRecords.some((record) => !record.estimatedRenewalFetchedAt || now - new Date(record.estimatedRenewalFetchedAt) > PRICE_REFRESH_MS);
    if (!stale) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const prices = await reader.getRenewalPrices(tld);
      // eslint-disable-next-line no-await-in-loop
      await applyEstimates(tldRecords, tld, prices, now);
      summary.pricesFetched += 1;
    } catch (err) {
      summary.errors.push({ step: 'pricing', tld, ...safeError(err) });
      if (err instanceof RegistrarError && ['budget_exhausted', 'rate_limited'].includes(err.kind)) break;
    }
  }
}

function certificateDomain(hostName) {
  if (!hostName) return null;
  const parsed = parseDomainInput(hostName.replace(/^\*\./, ''));
  return parsed.ok ? parsed.registrableDomain : null;
}

/** SSL certificates bought through Namecheap — a verified source for those certificates only. */
async function syncSsl(agencyOrganizationId, reader, now, summary) {
  const certificates = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await reader.listSslCertificatesPage(page);
    certificates.push(...result.certificates);
    if (result.certificates.length < PAGE_SIZE || (result.totalItems !== null && page * PAGE_SIZE >= result.totalItems)) break;
  }
  const byDomain = new Map();
  for (const certificate of certificates) {
    const domain = certificateDomain(certificate.hostName);
    if (!domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(certificate);
  }
  const records = await access.domainRecords.findAll(agencyOrganizationId, {
    where: { [Op.or]: [{ domainName: [...byDomain.keys()] }, { providerSslSyncedAt: { [Op.ne]: null } }] },
  });
  for (const record of records) {
    // eslint-disable-next-line no-await-in-loop
    await record.update({ providerSslCertificates: byDomain.get(record.domainName) || [], providerSslSyncedAt: now });
  }
  summary.sslCertificates = certificates.length;
}

/**
 * One full sync for a workspace. Returns immediately with started:false
 * if another sync holds the lock or no credentials are saved.
 */
async function runSync({ agencyOrganizationId, trigger = 'manual' }) {
  const startedAt = new Date();
  if (!(await acquireLock(agencyOrganizationId, trigger, startedAt))) return { started: false };
  const connection = await connectionService.getConnection(agencyOrganizationId);
  const summary = {
    domainsSeen: 0, domainsAdded: 0, markedMissing: 0, nameserversFetched: 0, pricesFetched: 0, sslCertificates: 0, errors: [],
  };
  let listComplete = false;
  let fatal = null;
  let reader;

  try {
    reader = connectionService.readerFor(connection);
    const { seen, complete } = await syncDomainList(agencyOrganizationId, reader, connection, startedAt, summary);
    listComplete = complete;
    if (complete) await markMissing(agencyOrganizationId, seen, startedAt, summary);

    const optionalSteps = [
      ['nameservers', () => syncNameservers(agencyOrganizationId, reader, startedAt, summary)],
      ['pricing', () => syncPrices(agencyOrganizationId, reader, startedAt, summary)],
      ['ssl', () => syncSsl(agencyOrganizationId, reader, startedAt, summary)],
      ['balances', async () => {
        const balances = await reader.getBalances();
        await connection.update({ accountSnapshot: { ...balances, fetchedAt: startedAt } });
      }],
    ];
    for (const [step, run] of optionalSteps) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await run();
      } catch (err) {
        if (err instanceof RegistrarError && connectionService.AUTH_ERROR_KINDS.has(err.kind)) throw err;
        summary.errors.push({ step, ...safeError(err) });
      }
    }
  } catch (err) {
    fatal = err;
  }

  const finishedAt = new Date();
  let status = 'success';
  if (fatal) status = 'failed';
  else if (summary.errors.length || !listComplete) status = 'partial';
  summary.apiCalls = reader?.callCount ?? 0;

  const update = {
    syncLockedUntil: null, lastSyncFinishedAt: finishedAt, lastSyncStatus: status, lastSyncSummary: summary,
  };
  // Disconnected while this sync ran: record the outcome, but don't revive the connection.
  await access.reload(connection);
  if (!connection.credentialsCiphertext) {
    await connection.update(update);
    return { started: true, status, summary };
  }
  if (listComplete) Object.assign(update, { lastSuccessfulSyncAt: finishedAt, lastVerifiedAt: finishedAt, status: 'connected' });
  if (fatal) {
    const fields = connectionService.errorFields(fatal, finishedAt);
    Object.assign(update, fields);
    if (connectionService.AUTH_ERROR_KINDS.has(fields.lastErrorKind) || fields.lastErrorKind === 'credentials_unreadable') update.status = 'error';
  } else if (summary.errors.length) {
    Object.assign(update, {
      lastErrorKind: summary.errors[0].kind || 'partial', lastErrorMessage: summary.errors[0].message, lastErrorProviderCode: summary.errors[0].providerCode || null, lastErrorAt: finishedAt,
    });
  } else {
    Object.assign(update, {
      lastErrorKind: null, lastErrorMessage: null, lastErrorProviderCode: null, lastErrorAt: null,
    });
  }
  await connection.update(update);
  return { started: true, status, summary };
}

// ─── Single-domain check (client/project forms, "Check again") ─────────

function needsProviderCheck(record, connection, now = new Date()) {
  if (!connection?.credentialsCiphertext) return false;
  if (record?.providerLastSeenAt && !record.providerMissingSince) {
    const inventoryFresh = connection.lastSuccessfulSyncAt && now - new Date(connection.lastSuccessfulSyncAt) < INVENTORY_FRESH_MS;
    const recordFresh = now - new Date(record.providerLastSeenAt) < INVENTORY_FRESH_MS;
    if (inventoryFresh && recordFresh) return false;
  }
  if (record?.providerCheckedAt && now - new Date(record.providerCheckedAt) < RECENT_CHECK_MS) return false;
  return true;
}

/**
 * Looks one domain up in the connected account (one API call, within the
 * shared rate budget). Found → its details are stored like a sync would;
 * not found → recorded as checked, so the UI can say "Not found in
 * connected account". A failed check changes nothing.
 */
async function checkDomain({
  agencyOrganizationId, domainName, force = false, fresh = false,
}) {
  const connection = await connectionService.getConnection(agencyOrganizationId);
  if (!connection?.credentialsCiphertext) return { checked: false, reason: 'not_connected' };
  if (connection.status === 'error' && connectionService.AUTH_ERROR_KINDS.has(connection.lastErrorKind)) {
    return { checked: false, reason: 'connection_error', message: connection.lastErrorMessage };
  }
  const now = new Date();
  const cacheKey = `${agencyOrganizationId}|${domainName}`;
  const recent = recentChecks.get(cacheKey);
  // Automatic checks reuse a result for 10 minutes; "Check again" always asks
  // Namecheap, except when clicked repeatedly within 30 seconds.
  // fresh: always ask (e.g. right after a paid renewal, to read the new expiry).
  let reusable = false;
  if (!fresh) {
    reusable = force
      ? recent?.forcedAt && now - recent.forcedAt < FORCED_CHECK_COOLDOWN_MS
      : recent && now - recent.at < RECENT_CHECK_MS;
  }
  if (reusable) return { checked: true, found: recent.found, cached: true };

  let result;
  try {
    result = await connectionService.readerFor(connection).findDomain(domainName, { retries: 0, timeoutMs: 10000 });
  } catch (err) {
    if (err instanceof RegistrarError && connectionService.AUTH_ERROR_KINDS.has(err.kind)) {
      await connection.update({ status: 'error', ...connectionService.errorFields(err, now) });
    }
    return { checked: false, reason: 'check_failed', error: safeError(err) };
  }
  if (!result.searchable) return { checked: false, reason: 'not_searchable' };

  if (result.domain) {
    await applyListedDomain(agencyOrganizationId, result.domain, connection, now);
  } else {
    const record = await access.domainRecords.findOne(agencyOrganizationId, { where: { domainName } });
    if (record) {
      const updates = { providerCheckedAt: now };
      if (record.providerLastSeenAt && !record.providerMissingSince) updates.providerMissingSince = now;
      await record.update(updates);
    }
  }
  await connection.update({
    lastVerifiedAt: now,
    ...(connection.status === 'connected' ? {} : {
      status: 'connected', lastErrorKind: null, lastErrorMessage: null, lastErrorProviderCode: null, lastErrorAt: null,
    }),
  });
  recentChecks.set(cacheKey, { at: now, found: Boolean(result.domain), forcedAt: force ? now : recent?.forcedAt });
  return { checked: true, found: Boolean(result.domain) };
}

/** After a domain is linked: fill in nameservers and a renewal estimate if missing (best effort, ≤2 calls). */
async function enrichLinkedDomain(agencyOrganizationId, domainName) {
  const record = await access.domainRecords.findOne(agencyOrganizationId, { where: { domainName } });
  if (!record?.providerLastSeenAt || record.providerMissingSince) return;
  const connection = await connectionService.getConnection(agencyOrganizationId);
  if (!connection?.credentialsCiphertext || connection.status === 'error') return;
  const now = new Date();
  const reader = connectionService.readerFor(connection);
  if (!record.providerNameserversSyncedAt) {
    try {
      const dns = await reader.getNameservers(domainName);
      await record.update({
        providerNameservers: dns.nameservers, providerUsesNamecheapDns: keep(dns.usesNamecheapDns, record.providerUsesNamecheapDns), providerNameserversSyncedAt: now, providerNameserversError: null,
      });
    } catch { /* the daily sync retries */ }
  }
  if (!record.estimatedRenewalFetchedAt || now - new Date(record.estimatedRenewalFetchedAt) > PRICE_REFRESH_MS) {
    const tld = tldOf(domainName);
    if (!tld) return;
    try {
      await applyEstimates([record], tld, await reader.getRenewalPrices(tld), now);
    } catch { /* the daily sync retries */ }
  }
}

/** Test hook. */
function clearRecentChecks() {
  recentChecks.clear();
}

module.exports = {
  runSync,
  checkDomain,
  needsProviderCheck,
  enrichLinkedDomain,
  estimateFromPrices,
  clearRecentChecks,
  INVENTORY_FRESH_MS,
};

'use strict';

const { displayDomain } = require('./domainName');

/**
 * Pure rules for the domain registry (ADR 0009) — no database access, so
 * every edge case is unit-testable:
 *
 * - linkState: whether a client/project's domain link may show registrar
 *   data, and if not, why ("Not found in connected account", conflict…);
 * - domainFacts: each value paired with where it came from (namecheap |
 *   manual | estimate), manual overrides winning and the provider's own
 *   value kept alongside;
 * - hosting allocation and cost totals that never count a shared bill
 *   in full for every client, and never turn "unknown" into $0.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PROVIDER_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function daysUntil(dateOnly, today = new Date()) {
  if (!dateOnly) return null;
  const [y, m, d] = dateOnly.split('-').map(Number);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.UTC(y, m - 1, d) - todayUtc) / DAY_MS);
}

function isProviderBacked(record) {
  return Boolean(record && record.providerKey && record.providerLastSeenAt);
}

function hasCredentials(connection) {
  return Boolean(connection && connection.credentialsCiphertext);
}

/**
 * Who a registration belongs to, from every non-rejected link to it:
 * one client with an apex/www link → linked; only subdomain links →
 * review (e.g. a site on "client.ouragency.com" says nothing about who
 * owns ouragency.com); links from several clients → conflict, unless a
 * person confirmed one of them.
 */
function recordOwnership(record, links) {
  const active = links.filter((link) => link.linkOverride !== 'rejected');
  if (active.length === 0) return { status: 'unlinked', organizationIds: [] };
  const confirmedOrgs = [...new Set(active.filter((link) => link.linkOverride === 'confirmed').map((link) => link.organizationId))];
  if (confirmedOrgs.length === 1) return { status: 'linked', organizationIds: confirmedOrgs, confirmed: true };
  const orgs = [...new Set(active.map((link) => link.organizationId))];
  if (confirmedOrgs.length > 1 || orgs.length > 1) return { status: 'conflict', organizationIds: confirmedOrgs.length > 1 ? confirmedOrgs : orgs };
  const hasApexLink = active.some((link) => link.hostname === record.domainName);
  return { status: hasApexLink ? 'linked' : 'review', organizationIds: orgs, confirmed: false };
}

/**
 * The state one link shows. Provider data is shown only for 'linked' and
 * 'missing' (last known details, clearly labelled).
 */
function linkState(link, record, allLinksToRecord, connection) {
  if (link.linkOverride === 'rejected') return { state: 'unlinked' };
  // Ownership first: a registration another client owns (or that is
  // disputed) never shows its details — provider or manual — on this link.
  const ownership = recordOwnership(record, allLinksToRecord);
  if (ownership.status === 'conflict') {
    return { state: 'conflict', otherOrganizationIds: ownership.organizationIds.filter((id) => id !== link.organizationId) };
  }
  if (ownership.status === 'linked' && !ownership.organizationIds.includes(link.organizationId)) {
    return { state: 'conflict', otherOrganizationIds: ownership.organizationIds };
  }
  if (!isProviderBacked(record)) {
    if (!hasCredentials(connection)) return { state: 'manual' };
    const checkedSinceCreated = record.providerCheckedAt
      || (connection.lastSuccessfulSyncAt && new Date(connection.lastSuccessfulSyncAt) >= new Date(record.createdAt));
    return { state: checkedSinceCreated ? 'not_found' : 'pending' };
  }
  if (ownership.status === 'review') return { state: 'review' };
  if (record.providerMissingSince) return { state: 'missing', since: record.providerMissingSince, linkedBy: ownership.confirmed ? 'manual' : 'auto' };
  return { state: 'linked', linkedBy: ownership.confirmed ? 'manual' : 'auto' };
}

const LINK_STATE_LABELS = {
  linked: 'Matched in Namecheap',
  missing: 'Not found in connected account',
  not_found: 'Not found in connected account',
  pending: 'Not checked yet',
  manual: 'Manual details',
  unlinked: 'Unlinked — manual details',
  conflict: 'Needs review — also claimed by another client',
  review: 'Needs review — matched by subdomain only',
};

function valueWithSource(value, source, extra = {}) {
  return { value: value ?? null, source: value === null || value === undefined ? null : source, ...extra };
}

function providerIsStale(record, connection, now = new Date()) {
  if (!isProviderBacked(record)) return false;
  if (!hasCredentials(connection) || connection.status === 'error') return true;
  return now - new Date(record.providerLastSeenAt) > PROVIDER_STALE_AFTER_MS;
}

/** Effective renewal cost: a manual amount wins; else the catalog estimate; else unknown. */
function renewalCost(record) {
  const estimate = record.estimatedRenewalCents !== null && record.estimatedRenewalCents !== undefined
    ? {
      cents: record.estimatedRenewalCents,
      currency: record.estimatedRenewalCurrency,
      years: record.estimatedRenewalYears,
      fetchedAt: record.estimatedRenewalFetchedAt,
      note: record.estimatedRenewalNote,
    }
    : null;
  if (record.renewalPriceCents !== null && record.renewalPriceCents !== undefined) {
    return {
      cents: record.renewalPriceCents,
      currency: record.renewalCurrency || 'USD',
      periodMonths: record.renewalPeriodMonths || 12,
      source: 'manual',
      estimate,
      note: record.estimatedRenewalNote || null,
    };
  }
  if (estimate) {
    return {
      cents: estimate.cents, currency: estimate.currency || 'USD', periodMonths: (estimate.years || 1) * 12, source: 'estimate', estimate, note: estimate.note,
    };
  }
  return {
    cents: null, currency: null, periodMonths: null, source: null, estimate: null, note: record.estimatedRenewalNote || null,
  };
}

function domainFacts(record, connection, now = new Date()) {
  const backed = isProviderBacked(record);
  const present = backed && !record.providerMissingSince;

  let registrar = valueWithSource(null, null);
  if (present) registrar = valueWithSource('Namecheap', 'namecheap', { manualValue: record.registrarName || null });
  else if (record.registrarName) registrar = valueWithSource(record.registrarName, 'manual');
  else if (backed) registrar = valueWithSource('Namecheap', 'namecheap', { lastKnown: true });

  const providerExpires = backed ? toDateOnly(record.providerExpiresOn) : null;
  const expiresOn = record.manualExpiresOn
    ? valueWithSource(toDateOnly(record.manualExpiresOn), 'manual', { providerValue: providerExpires })
    : valueWithSource(providerExpires, 'namecheap');

  const providerAutoRenew = backed ? record.providerAutoRenew : null;
  const autoRenew = record.manualAutoRenew !== null && record.manualAutoRenew !== undefined
    ? valueWithSource(record.manualAutoRenew, 'manual', { providerValue: providerAutoRenew ?? null })
    : valueWithSource(providerAutoRenew, 'namecheap');

  const registeredOn = backed && record.providerCreatedOn
    ? valueWithSource(toDateOnly(record.providerCreatedOn), 'namecheap')
    : valueWithSource(toDateOnly(record.manualRegisteredOn), 'manual');

  let dnsProvider = valueWithSource(record.dnsProviderName, 'manual');
  if (!record.dnsProviderName && backed && record.providerUsesNamecheapDns === true) dnsProvider = valueWithSource('Namecheap DNS', 'namecheap');

  return {
    domainName: record.domainName,
    displayName: displayDomain(record.domainName),
    inConnectedAccount: present,
    registrar,
    registeredOn,
    expiresOn,
    daysUntilExpiry: daysUntil(expiresOn.value, now),
    autoRenew,
    providerStatus: backed ? {
      isExpired: record.providerIsExpired,
      isLocked: record.providerIsLocked,
      isPremium: record.providerIsPremium,
      privacy: record.providerPrivacy,
    } : null,
    dns: {
      provider: dnsProvider,
      nameservers: backed ? record.providerNameservers : null,
      nameserversSyncedAt: backed ? record.providerNameserversSyncedAt : null,
      nameserversError: backed ? record.providerNameserversError : null,
    },
    sslCertificates: record.providerSslCertificates || [],
    renewal: renewalCost(record),
    nextChargeOn: valueWithSource(toDateOnly(record.nextChargeOn), 'manual'),
    clientCharge: record.clientChargeCents !== null && record.clientChargeCents !== undefined
      ? { cents: record.clientChargeCents, periodMonths: record.clientChargePeriodMonths || 12 }
      : null,
    notes: record.notes,
    sync: {
      provider: record.providerKey,
      lastSeenAt: record.providerLastSeenAt,
      checkedAt: record.providerCheckedAt,
      missingSince: record.providerMissingSince,
      stale: providerIsStale(record, connection, now),
    },
    ignoredAt: record.ignoredAt,
  };
}

// ─── Costs ─────────────────────────────────────────────────────────────

/** Converts an amount per `periodMonths` to a yearly amount; unknown stays unknown. */
function annualize(cents, periodMonths) {
  if (cents === null || cents === undefined || !periodMonths) return null;
  return Math.round((cents * 12) / periodMonths);
}

/**
 * Each client's share of a hosting plan. Shares always sum to at most the
 * plan's cost: 'equal' splits it (spreading leftover cents), 'manual' uses
 * the amounts entered (unset = unknown), 'none' leaves it all as agency
 * overhead. A plan with unknown cost gives unknown shares.
 */
function hostingShares(plan, planClients) {
  const shares = new Map();
  const clients = [...planClients].sort((a, b) => String(a.organizationId).localeCompare(String(b.organizationId)));
  for (const planClient of clients) shares.set(planClient.organizationId, null);
  if (plan.costCents === null || plan.costCents === undefined || clients.length === 0) return shares;
  if (plan.allocationMethod === 'equal') {
    const base = Math.floor(plan.costCents / clients.length);
    let remainder = plan.costCents - base * clients.length;
    for (const planClient of clients) {
      shares.set(planClient.organizationId, base + (remainder > 0 ? 1 : 0));
      remainder -= 1;
    }
  } else if (plan.allocationMethod === 'manual') {
    for (const planClient of clients) shares.set(planClient.organizationId, planClient.allocatedCents ?? null);
  }
  return shares;
}

/** Sum of known values plus how many were unknown — "unknown" never becomes $0. */
function tally(values) {
  let knownCents = 0;
  let knownCount = 0;
  let unknownCount = 0;
  for (const value of values) {
    if (value === null || value === undefined) unknownCount += 1;
    else {
      knownCents += value;
      knownCount += 1;
    }
  }
  return {
    knownCents: knownCount ? knownCents : null, knownCount, unknownCount, complete: unknownCount === 0,
  };
}

module.exports = {
  DAY_MS,
  LINK_STATE_LABELS,
  toDateOnly,
  daysUntil,
  isProviderBacked,
  hasCredentials,
  recordOwnership,
  linkState,
  domainFacts,
  renewalCost,
  annualize,
  hostingShares,
  tally,
};

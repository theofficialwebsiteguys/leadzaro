'use strict';

const crypto = require('node:crypto');
const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, Contact, StripeCustomerLink, WebhookEvent, SalesPayment, Subscription, BillingAccount, PaymentLinkRequest,
} = require('../../models');
const { env } = require('../../core/config/env');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');
const { recordAudit } = require('../../core/audit/auditService');
const {
  invalid, isUniqueViolation, registrableDomain, isEmail, nameKey, FREE_EMAIL_DOMAINS,
} = require('./salesCommon');

/**
 * The Stripe side of a sale (ADR 0011): connection status, the product/
 * price catalog and linking a business to a Stripe customer. Credentials
 * live only in server environment variables — never in the database,
 * frontend or logs.
 */

const WEBHOOK_PATH = '/api/v1/billing/webhooks/stripe';
let accountCache = { at: 0, value: null };
let pingCache = { at: 0, problem: null };
let catalogCache = { at: 0, mode: null, value: null };

function webhookSecretConfigured() {
  return Boolean(env.STRIPE_WEBHOOK_SECRET) && !env.STRIPE_WEBHOOK_SECRET.includes('placeholder');
}

async function getStatus() {
  const adapter = getStripeAdapter();
  const base = {
    provider: env.STRIPE_PROVIDER,
    mode: adapter.mode,
    connected: adapter.configured,
    restrictedKey: Boolean(adapter.restricted),
    webhookSecretConfigured: adapter.mode === 'mock' ? true : webhookSecretConfigured(),
    webhookPath: WEBHOOK_PATH,
    automaticTax: env.STRIPE_AUTOMATIC_TAX,
    promotionCodes: env.STRIPE_ALLOW_PROMOTION_CODES,
    defaultCurrency: env.STRIPE_DEFAULT_CURRENCY,
    checkoutExpiryHours: env.STRIPE_CHECKOUT_EXPIRY_HOURS,
    account: null,
    accountError: null,
    lastWebhookAt: null,
    failedWebhooks: 0,
    problem: null,
  };
  if (!adapter.configured) {
    base.problem = env.STRIPE_PROVIDER === 'live'
      ? 'STRIPE_PROVIDER is "live" but STRIPE_SECRET_KEY is missing or still a placeholder.'
      : 'Stripe is not connected.';
    return base;
  }
  if (Date.now() - accountCache.at > 5 * 60 * 1000 || !accountCache.value) {
    accountCache = { at: Date.now(), value: await adapter.getAccount() };
  }
  base.account = accountCache.value.id || accountCache.value.name ? { id: accountCache.value.id, name: accountCache.value.name, defaultCurrency: accountCache.value.defaultCurrency } : null;
  base.accountError = accountCache.value.error ? 'Account details are not readable with this key (grant “Account: Read” on the restricted key to show them). Payments still work.' : null;
  // The key check is cached like the account lookup, so dashboards and
  // settings never call Stripe on every page load (ADR 0012).
  if (adapter.mode !== 'mock') {
    if (Date.now() - pingCache.at > 5 * 60 * 1000) {
      try {
        await adapter.ping();
        pingCache = { at: Date.now(), problem: null };
      } catch (err) {
        pingCache = { at: Date.now(), problem: `Stripe rejected the API key: ${err.message}` };
      }
    }
    base.problem = pingCache.problem;
  }
  base.checkedAt = new Date(Math.max(accountCache.at, pingCache.at || 0));
  const last = await WebhookEvent.findOne({ order: [['createdAt', 'DESC']], attributes: ['createdAt'] });
  base.lastWebhookAt = last?.createdAt || null;
  base.failedWebhooks = await WebhookEvent.count({ where: { status: 'failed' } });
  if (!base.problem && !base.webhookSecretConfigured) base.problem = 'STRIPE_WEBHOOK_SECRET is not set, so Leadzaro cannot confirm payments.';
  return base;
}

async function getCatalog() {
  const adapter = getStripeAdapter();
  if (!adapter.configured) throw invalid('Stripe is not connected.', 503);
  if (catalogCache.value && catalogCache.mode === adapter.mode && Date.now() - catalogCache.at < 60 * 1000) return catalogCache.value;
  const prices = (await adapter.listPrices()).filter((p) => !p.isCustomOffer);
  const products = new Map();
  for (const price of prices) {
    if (!products.has(price.productId)) products.set(price.productId, { id: price.productId, name: price.productName, description: price.productDescription, prices: [] });
    products.get(price.productId).prices.push(price);
  }
  const value = [...products.values()].sort((a, b) => a.name.localeCompare(b.name));
  catalogCache = { at: Date.now(), mode: adapter.mode, value };
  return value;
}

function clearCatalogCache() {
  catalogCache = { at: 0, mode: null, value: null };
}

async function loadBusiness(ctx, organizationId) {
  const organization = await Organization.findOne({
    where: {
      id: organizationId, managingAgencyOrganizationId: ctx.agencyId, deletedAt: null, type: ['prospect', 'client'],
    },
  });
  if (!organization) throw invalid('Business not found', 404);
  return organization;
}

async function activeLink(agencyId, organizationId) {
  return StripeCustomerLink.findOne({ where: { agencyOrganizationId: agencyId, organizationId, stripeMode: getStripeAdapter().mode, archivedAt: null } });
}

async function describeLink(agencyId, organizationId) {
  const adapter = getStripeAdapter();
  const link = await activeLink(agencyId, organizationId);
  const otherModes = await StripeCustomerLink.findAll({
    where: {
      agencyOrganizationId: agencyId, organizationId, archivedAt: null, stripeMode: { [Op.ne]: adapter.mode },
    },
    attributes: ['stripeMode', 'stripeCustomerId'],
  });
  return {
    mode: adapter.mode,
    link: link ? {
      id: link.id, stripeCustomerId: link.stripeCustomerId, email: link.email, name: link.name, linkMethod: link.linkMethod, createdAt: link.createdAt,
    } : null,
    otherModes: otherModes.map((l) => ({ mode: l.stripeMode, stripeCustomerId: l.stripeCustomerId })),
  };
}

/** Search the Stripe account. Results show which Leadzaro business each customer is already linked to. */
async function searchCustomers(ctx, query) {
  const adapter = getStripeAdapter();
  const results = await adapter.searchCustomers(query);
  const links = results.length
    ? await StripeCustomerLink.findAll({
      where: { agencyOrganizationId: ctx.agencyId, stripeCustomerId: results.map((r) => r.id), archivedAt: null },
      include: [{ model: Organization, as: 'organization', attributes: ['id', 'name'] }],
    })
    : [];
  return results.map((customer) => {
    const link = links.find((l) => l.stripeCustomerId === customer.id);
    return { ...customer, linkedTo: link ? { organizationId: link.organizationId, name: link.organization?.name } : null };
  });
}

async function saveLink(ctx, organization, customer, linkMethod) {
  const adapter = getStripeAdapter();
  const taken = await StripeCustomerLink.findOne({ where: { agencyOrganizationId: ctx.agencyId, stripeCustomerId: customer.id, archivedAt: null } });
  if (taken && taken.organizationId !== organization.id) {
    const other = await Organization.findByPk(taken.organizationId, { attributes: ['name'] });
    throw invalid(`That Stripe customer is already linked to ${other?.name || 'another business'}.`, 409);
  }
  if (taken) return taken;
  const current = await activeLink(ctx.agencyId, organization.id);
  if (current) await current.update({ archivedAt: new Date() });
  let link;
  try {
    link = await StripeCustomerLink.create({
      agencyOrganizationId: ctx.agencyId,
      organizationId: organization.id,
      stripeCustomerId: customer.id,
      stripeMode: adapter.mode,
      email: customer.email || null,
      name: customer.name || null,
      linkMethod,
      linkedByUserId: ctx.userId,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw invalid('This business was just linked to a Stripe customer by someone else — refresh and try again.', 409);
    throw err;
  }
  if (organization.type === 'client') {
    const [account] = await BillingAccount.findOrCreate({ where: { organizationId: organization.id }, defaults: { organizationId: organization.id, stripeCustomerId: customer.id, status: 'active' } });
    if (!account.stripeCustomerId) await account.update({ stripeCustomerId: customer.id });
  }
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'stripe.customer_linked', targetType: 'Organization', targetId: organization.id, metadata: { stripeCustomerId: customer.id, mode: adapter.mode, linkMethod }, req: ctx.req,
  });
  return link;
}

async function linkCustomer(ctx, organizationId, stripeCustomerId) {
  const organization = await loadBusiness(ctx, organizationId);
  const customer = await getStripeAdapter().retrieveCustomer(String(stripeCustomerId || '').trim());
  if (!customer) throw invalid('That Stripe customer does not exist (or was deleted) in the connected account.', 404);
  await saveLink(ctx, organization, customer, 'linked');
  return describeLink(ctx.agencyId, organization.id);
}

async function primaryContact(organizationId) {
  return Contact.findOne({ where: { organizationId, archivedAt: null, deletedAt: null }, order: [['isPrimary', 'DESC'], ['createdAt', 'ASC']] });
}

/**
 * Creates a Stripe customer from the business. Email matches in Stripe are
 * returned as candidates to link instead — never merged automatically —
 * unless the caller confirms a new customer is wanted.
 */
async function createCustomer(ctx, organizationId, input = {}) {
  const organization = await loadBusiness(ctx, organizationId);
  const existing = await activeLink(ctx.agencyId, organization.id);
  if (existing) return describeLink(ctx.agencyId, organization.id);
  const contact = await primaryContact(organization.id);
  const email = String(input.email || contact?.email || organization.email || '').trim() || null;
  if (email && !isEmail(email)) throw invalid('That email address does not look valid.');
  const adapter = getStripeAdapter();
  if (email && !input.confirmNew) {
    const candidates = await searchCustomers(ctx, email);
    if (candidates.length) throw invalid('Stripe already has customers with this email. Link one of them, or confirm you want a new customer.', 409, { candidates });
  }
  const address = organization.addressLine1 ? {
    line1: organization.addressLine1, city: organization.city || undefined, state: organization.state || undefined, postal_code: organization.postalCode || undefined,
  } : undefined;
  const fields = {
    name: String(input.name || organization.name).slice(0, 250),
    email,
    phone: input.phone || contact?.phone || organization.phone || null,
    address,
    metadata: { leadzaroOrganizationId: organization.id, leadzaroAgencyOrganizationId: ctx.agencyId },
  };
  // A double submit with the same details returns the same Stripe customer.
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([fields.name, fields.email, fields.phone])).digest('hex').slice(0, 16);
  const customer = await adapter.createCustomer(fields, `lz-cus-${organization.id}-${adapter.mode}-${fingerprint}`);
  await saveLink(ctx, organization, customer, 'created');
  return describeLink(ctx.agencyId, organization.id);
}

const UPDATABLE = ['name', 'email', 'phone'];

async function updateCustomer(ctx, organizationId, input) {
  const organization = await loadBusiness(ctx, organizationId);
  const link = await activeLink(ctx.agencyId, organization.id);
  if (!link) throw invalid('This business is not linked to a Stripe customer yet.', 409);
  const fields = {};
  for (const key of UPDATABLE) {
    if (input[key] === undefined) continue;
    const value = String(input[key] || '').trim();
    if (key === 'email' && value && !isEmail(value)) throw invalid('That email address does not look valid.');
    fields[key] = value || '';
  }
  if (!Object.keys(fields).length) throw invalid('Nothing to update.');
  const customer = await getStripeAdapter().updateCustomer(link.stripeCustomerId, fields);
  await link.update({ email: customer?.email || link.email, name: customer?.name || link.name });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'stripe.customer_updated', targetType: 'Organization', targetId: organization.id, metadata: { fields: Object.keys(fields) }, req: ctx.req,
  });
  return describeLink(ctx.agencyId, organization.id);
}

async function unlinkCustomer(ctx, organizationId) {
  const organization = await loadBusiness(ctx, organizationId);
  const link = await activeLink(ctx.agencyId, organization.id);
  if (link) {
    await link.update({ archivedAt: new Date() });
    await recordAudit({
      organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'stripe.customer_unlinked', targetType: 'Organization', targetId: organization.id, metadata: { stripeCustomerId: link.stripeCustomerId }, req: ctx.req,
    });
  }
  return describeLink(ctx.agencyId, organization.id);
}

/**
 * Candidate Stripe customers for a business — matched by the business's
 * own email/phone or its contacts'. Candidates only; a person decides.
 */
async function suggestCustomers(ctx, organizationId) {
  const organization = await loadBusiness(ctx, organizationId);
  const contacts = await Contact.findAll({ where: { organizationId: organization.id, archivedAt: null, deletedAt: null } });
  const emails = [...new Set([organization.email, ...contacts.map((c) => c.email)].filter(Boolean))].slice(0, 3);
  const seen = new Map();
  for (const email of emails) {
    for (const customer of await searchCustomers(ctx, email)) seen.set(customer.id, { ...customer, matchedOn: 'email' });
  }
  if (!seen.size && organization.name) {
    for (const customer of await searchCustomers(ctx, organization.name).catch(() => [])) seen.set(customer.id, { ...customer, matchedOn: 'name' });
  }
  const domain = registrableDomain(organization.website);
  return [...seen.values()].map((c) => ({ ...c, sameWebsiteDomain: Boolean(domain && c.email && registrableDomain(c.email) === domain) }));
}

// One customer list per workspace and Stripe mode, reused for 10 minutes
// so reviewing matches never re-reads the whole Stripe account per click.
const CUSTOMER_LIST_TTL_MS = 10 * 60 * 1000;
const customerListCache = new Map();

async function allCustomers(agencyId, { refresh = false } = {}) {
  const adapter = getStripeAdapter();
  const key = `${agencyId}:${adapter.mode}`;
  const cached = customerListCache.get(key);
  if (!refresh && cached && Date.now() - cached.at < CUSTOMER_LIST_TTL_MS) return cached;
  const { customers, truncated } = await adapter.listAllCustomers();
  const entry = { at: Date.now(), customers, truncated };
  customerListCache.set(key, entry);
  return entry;
}

const MATCH_STRENGTH = { email: 3, website: 2, name: 1 };

/**
 * Suggested Stripe customers for every client not yet linked (ADR 0013).
 * Matched locally against one read of the customer list: the same email
 * is a strong match, an email on the client's website domain a good one,
 * the same business name only a hint. Several candidates, or a name-only
 * match, is shown as ambiguous for a person to decide. Nothing is linked
 * automatically, and a customer already linked to another business is
 * never offered.
 */
async function matchClients(ctx, { refresh = false } = {}) {
  const adapter = getStripeAdapter();
  if (!adapter.configured) throw invalid('Stripe isn’t connected yet — add the API key (see Settings → Integrations).', 409);
  const clients = await Organization.findAll({
    where: { type: 'client', managingAgencyOrganizationId: ctx.agencyId, deletedAt: null },
    attributes: ['id', 'name', 'email', 'website'],
    order: [['name', 'ASC']],
  });
  const links = await StripeCustomerLink.findAll({ where: { agencyOrganizationId: ctx.agencyId, stripeMode: adapter.mode, archivedAt: null } });
  const linkedOrgs = new Set(links.map((l) => l.organizationId));
  const takenCustomers = new Set(links.map((l) => l.stripeCustomerId));
  const unlinked = clients.filter((c) => !linkedOrgs.has(c.id));
  const { customers, truncated, at } = await allCustomers(ctx.agencyId, { refresh });

  const ids = unlinked.map((c) => c.id);
  const contacts = ids.length ? await Contact.findAll({
    where: {
      organizationId: ids, archivedAt: null, deletedAt: null, email: { [Op.ne]: null },
    },
    attributes: ['organizationId', 'email'],
  }) : [];
  const [profiles] = ids.length ? await sequelize.query(
    'SELECT "organizationId", "websiteUrl" FROM "ClientProfiles" WHERE "agencyOrganizationId" = :agencyId AND "organizationId" IN (:ids) AND "websiteUrl" IS NOT NULL',
    { replacements: { agencyId: ctx.agencyId, ids } },
  ) : [[]];

  const byEmail = new Map();
  const byDomain = new Map();
  const byName = new Map();
  const push = (map, key, customer) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(customer);
  };
  for (const customer of customers) {
    if (takenCustomers.has(customer.id)) continue;
    const email = customer.email ? customer.email.toLowerCase() : null;
    push(byEmail, email, customer);
    const domain = email ? registrableDomain(email) : null;
    if (domain && !FREE_EMAIL_DOMAINS.has(domain)) push(byDomain, domain, customer);
    push(byName, nameKey(customer.name), customer);
  }

  const results = unlinked.map((client) => {
    const emails = new Set([client.email, ...contacts.filter((c) => c.organizationId === client.id).map((c) => c.email)]
      .filter(Boolean).map((e) => e.toLowerCase()));
    const domains = new Set([client.website, ...profiles.filter((p) => p.organizationId === client.id).map((p) => p.websiteUrl)]
      .map((w) => registrableDomain(w)).filter((d) => d && !FREE_EMAIL_DOMAINS.has(d)));
    const found = new Map();
    const consider = (customer, matchedOn) => {
      const current = found.get(customer.id);
      if (!current || MATCH_STRENGTH[matchedOn] > MATCH_STRENGTH[current.matchedOn]) found.set(customer.id, { customer, matchedOn });
    };
    for (const email of emails) for (const customer of byEmail.get(email) || []) consider(customer, 'email');
    for (const domain of domains) for (const customer of byDomain.get(domain) || []) consider(customer, 'website');
    for (const customer of byName.get(nameKey(client.name)) || []) consider(customer, 'name');
    const candidates = [...found.values()]
      .sort((a, b) => MATCH_STRENGTH[b.matchedOn] - MATCH_STRENGTH[a.matchedOn])
      .slice(0, 5)
      .map(({ customer, matchedOn }) => ({
        id: customer.id, name: customer.name, email: customer.email, created: customer.created, matchedOn,
      }));
    let status = 'none';
    if (candidates.length === 1 && candidates[0].matchedOn !== 'name') status = 'suggested';
    else if (candidates.length) status = 'ambiguous';
    return {
      id: client.id, name: client.name, status, candidates,
    };
  });
  const order = { suggested: 0, ambiguous: 1, none: 2 };
  results.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  return {
    mode: adapter.mode,
    customersScanned: customers.length,
    truncated,
    readAt: new Date(at),
    linkedCount: clients.length - unlinked.length,
    clientCount: clients.length,
    clients: results,
  };
}

/**
 * Billing summary for a business: payments recorded in Leadzaro plus,
 * when refreshed, invoices and subscriptions read live from Stripe.
 */
async function billingSummary(ctx, organizationId, { live = false } = {}) {
  const organization = await loadBusiness(ctx, organizationId);
  const customer = await describeLink(ctx.agencyId, organization.id);
  const payments = await SalesPayment.findAll({ where: { agencyOrganizationId: ctx.agencyId, organizationId: organization.id }, order: [['paidAt', 'DESC']], limit: 50 });
  const account = await BillingAccount.findOne({ where: { organizationId: organization.id } });
  const subscriptions = account ? await Subscription.findAll({ where: { billingAccountId: account.id }, order: [['createdAt', 'DESC']] }) : [];
  const summary = {
    customer, payments, subscriptions, invoices: null, liveError: null,
  };
  if (live && customer.link) {
    const adapter = getStripeAdapter();
    try {
      const [invoices, liveSubs] = await Promise.all([adapter.listInvoices(customer.link.stripeCustomerId), adapter.listSubscriptions(customer.link.stripeCustomerId)]);
      summary.invoices = invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountDue: inv.amount_due,
        amountPaid: inv.amount_paid,
        currency: inv.currency,
        created: new Date(inv.created * 1000),
        hostedInvoiceUrl: inv.hosted_invoice_url || null,
        invoicePdf: inv.invoice_pdf || null,
      }));
      const paymentEvents = require('./paymentEventsService'); // eslint-disable-line global-require
      for (const sub of liveSubs) await paymentEvents.handleSubscriptionEvent(sub, { eventCreated: Math.floor(Date.now() / 1000) });
      summary.subscriptions = account ? await Subscription.findAll({ where: { billingAccountId: account.id }, order: [['createdAt', 'DESC']] }) : summary.subscriptions;
    } catch (err) {
      summary.liveError = err.message;
    }
  }
  return summary;
}

async function opportunityInAgency(ctx, opportunityId) {
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  return opportunity;
}

async function hasOpenRequests(opportunityId) {
  return PaymentLinkRequest.count({ where: { opportunityId, status: ['created', 'sent', 'processing'] } });
}

module.exports = {
  WEBHOOK_PATH,
  getStatus,
  getCatalog,
  clearCatalogCache,
  describeLink,
  activeLink,
  searchCustomers,
  suggestCustomers,
  matchClients,
  linkCustomer,
  createCustomer,
  updateCustomer,
  unlinkCustomer,
  billingSummary,
  opportunityInAgency,
  hasOpenRequests,
  loadBusiness,
};

'use strict';

const crypto = require('node:crypto');
const { env } = require('../../config/env');

/**
 * Stripe provider boundary (ADR 0011). Every method returns a small,
 * normalized shape; callers never touch the Stripe SDK or raw objects
 * except webhook event payloads, which are handled in webhookService.
 *
 * - LiveStripeAdapter: the real account, using STRIPE_SECRET_KEY. The mode
 *   ('live' or 'test') comes from the key itself, so test and live records
 *   are always kept apart.
 * - MockStripeAdapter: development only; every id is prefixed `mock_`.
 * - DisabledStripeAdapter: Stripe not configured; every call explains so.
 */
class StripeAdapter {
  get mode() { return 'disabled'; }

  get configured() { return false; }
}

function notConfigured() {
  const err = new Error('Stripe is not connected. An administrator needs to add the Stripe API key on the server (see Settings → Stripe).');
  err.statusCode = 503;
  return err;
}

function friendlyStripeError(err) {
  if (err && err.type && String(err.type).startsWith('Stripe')) {
    const wrapped = new Error(
      err.type === 'StripePermissionError'
        ? `Stripe refused this action — the API key is missing a permission (${err.message})`
        : `Stripe: ${err.message}`,
    );
    wrapped.statusCode = err.statusCode && err.statusCode < 500 ? 422 : 502;
    wrapped.stripeCode = err.code;
    return wrapped;
  }
  return err;
}

function normalizeCustomer(c) {
  if (!c || c.deleted) return null;
  return {
    id: c.id,
    name: c.name || null,
    email: c.email || null,
    phone: c.phone || null,
    address: c.address || null,
    created: c.created ? new Date(c.created * 1000).toISOString() : null,
    metadata: c.metadata || {},
    livemode: Boolean(c.livemode),
  };
}

function normalizePrice(p) {
  const product = typeof p.product === 'object' ? p.product : null;
  return {
    id: p.id,
    productId: product ? product.id : p.product,
    productName: product ? product.name : (p.nickname || p.id),
    productDescription: product ? product.description || null : null,
    productActive: product ? product.active !== false : true,
    nickname: p.nickname || null,
    unitAmount: p.unit_amount,
    currency: p.currency,
    type: p.type,
    interval: p.recurring ? p.recurring.interval : null,
    intervalCount: p.recurring ? p.recurring.interval_count : null,
    lookupKey: p.lookup_key || null,
    isCustomOffer: (p.metadata && p.metadata.leadzaro === 'custom_offer') || false,
  };
}

function lineItemsParam(lineItems) {
  return lineItems.map((item) => ({ price: item.priceId, quantity: item.quantity || 1 }));
}

function customPriceLookupKey({
  name, amountCents, currency, interval,
}) {
  const hash = crypto.createHash('sha256').update(`${name.trim().toLowerCase()}|${amountCents}|${currency}|${interval || 'one_time'}`).digest('hex');
  return `lz_custom_${hash.slice(0, 32)}`;
}

class LiveStripeAdapter extends StripeAdapter {
  constructor(secretKey, webhookSecret) {
    super();
    // eslint-disable-next-line global-require
    const Stripe = require('stripe');
    this.stripe = new Stripe(secretKey, { appInfo: { name: 'Leadzaro' }, maxNetworkRetries: 2 });
    this.webhookSecret = webhookSecret;
    this.keyMode = /^(sk|rk)_live_/.test(secretKey) ? 'live' : 'test';
    this.restricted = secretKey.startsWith('rk_');
  }

  get mode() { return this.keyMode; }

  get configured() { return true; }

  async call(fn) {
    try {
      return await fn();
    } catch (err) {
      throw friendlyStripeError(err);
    }
  }

  async getAccount() {
    try {
      const account = await this.stripe.accounts.retrieve();
      return {
        id: account.id,
        name: account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id,
        defaultCurrency: account.default_currency || null,
        country: account.country || null,
        error: null,
      };
    } catch (err) {
      return {
        id: null, name: null, defaultCurrency: null, country: null, error: err.message,
      };
    }
  }

  /** A cheap authenticated call that works with a minimal restricted key. */
  async ping() {
    return this.call(async () => {
      await this.stripe.customers.list({ limit: 1 });
      return true;
    });
  }

  async searchCustomers(query) {
    return this.call(async () => {
      const trimmed = String(query || '').trim();
      if (!trimmed) return [];
      if (trimmed.includes('@')) {
        const res = await this.stripe.customers.list({ email: trimmed, limit: 10 });
        return res.data.map(normalizeCustomer).filter(Boolean);
      }
      if (/^cus_[A-Za-z0-9]+$/.test(trimmed)) {
        const customer = await this.stripe.customers.retrieve(trimmed).catch(() => null);
        return [normalizeCustomer(customer)].filter(Boolean);
      }
      const escaped = trimmed.replace(/["\\]/g, '');
      const res = await this.stripe.customers.search({ query: `name~"${escaped}" OR phone~"${escaped}"`, limit: 10 });
      return res.data.map(normalizeCustomer).filter(Boolean);
    });
  }

  async retrieveCustomer(id) {
    return this.call(async () => normalizeCustomer(await this.stripe.customers.retrieve(id)));
  }

  /** Every customer, 100 per request, up to `max` (for matching clients in bulk). */
  async listAllCustomers({ max = 2000 } = {}) {
    return this.call(async () => {
      const customers = [];
      let startingAfter;
      let hasMore = true;
      while (hasMore && customers.length < max) {
        // eslint-disable-next-line no-await-in-loop
        const page = await this.stripe.customers.list({ limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
        customers.push(...page.data.map(normalizeCustomer).filter(Boolean));
        hasMore = page.has_more;
        startingAfter = page.data.length ? page.data[page.data.length - 1].id : undefined;
        if (!startingAfter) hasMore = false;
      }
      return { customers, truncated: hasMore };
    });
  }

  async createCustomer({
    name, email, phone, address, metadata,
  }, idempotencyKey) {
    return this.call(async () => normalizeCustomer(await this.stripe.customers.create({
      name: name || undefined, email: email || undefined, phone: phone || undefined, address: address || undefined, metadata,
    }, idempotencyKey ? { idempotencyKey } : undefined)));
  }

  async updateCustomer(id, fields) {
    return this.call(async () => normalizeCustomer(await this.stripe.customers.update(id, fields)));
  }

  async listPrices() {
    return this.call(async () => {
      const prices = [];
      for await (const price of this.stripe.prices.list({ active: true, limit: 100, expand: ['data.product'] })) {
        if (price.unit_amount === null || price.billing_scheme !== 'per_unit') continue;
        const normalized = normalizePrice(price);
        if (!normalized.productActive) continue;
        prices.push(normalized);
        if (prices.length >= 300) break;
      }
      return prices;
    });
  }

  async retrievePrices(ids) {
    return this.call(async () => Promise.all(ids.map(async (id) => normalizePrice(await this.stripe.prices.retrieve(id, { expand: ['product'] })))));
  }

  /**
   * A custom offer reuses an identical earlier price (same name, amount,
   * currency, interval) through its lookup_key; an existing price is never
   * modified.
   */
  async findOrCreateCustomPrice(offer) {
    return this.call(async () => {
      const lookupKey = customPriceLookupKey(offer);
      const existing = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, expand: ['data.product'] });
      if (existing.data.length) return normalizePrice(existing.data[0]);
      const created = await this.stripe.prices.create({
        currency: offer.currency,
        unit_amount: offer.amountCents,
        recurring: offer.interval ? { interval: offer.interval } : undefined,
        product_data: { name: offer.name, metadata: { leadzaro: 'custom_offer' } },
        lookup_key: lookupKey,
        metadata: { leadzaro: 'custom_offer' },
      }, { idempotencyKey: `lz-price-${lookupKey}` });
      return normalizePrice({ ...created, product: { id: created.product, name: offer.name, active: true } });
    });
  }

  commonCheckoutParams({ recurring, metadata }) {
    const params = {
      metadata,
      allow_promotion_codes: env.STRIPE_ALLOW_PROMOTION_CODES || undefined,
      automatic_tax: env.STRIPE_AUTOMATIC_TAX ? { enabled: true } : undefined,
    };
    if (recurring) params.subscription_data = { metadata };
    else {
      params.payment_intent_data = { metadata };
      params.invoice_creation = { enabled: true, invoice_data: { metadata } };
    }
    return params;
  }

  async createPaymentLink({
    lineItems, recurring, metadata, idempotencyKey,
  }) {
    return this.call(async () => {
      const params = {
        line_items: lineItemsParam(lineItems),
        ...this.commonCheckoutParams({ recurring, metadata }),
        after_completion: { type: 'hosted_confirmation', hosted_confirmation: { custom_message: 'Thank you — your payment was received. We will be in touch shortly.' } },
      };
      if (!recurring) params.customer_creation = 'always';
      const link = await this.stripe.paymentLinks.create(params, { idempotencyKey });
      return { id: link.id, url: link.url, expiresAt: null };
    });
  }

  async deactivatePaymentLink(id) {
    return this.call(async () => {
      await this.stripe.paymentLinks.update(id, { active: false });
      return true;
    });
  }

  async createCheckoutSession({
    customerId, lineItems, recurring, metadata, expiresAt, successUrl, cancelUrl, idempotencyKey,
  }) {
    return this.call(async () => {
      const params = {
        mode: recurring ? 'subscription' : 'payment',
        customer: customerId,
        line_items: lineItemsParam(lineItems),
        ...this.commonCheckoutParams({ recurring, metadata }),
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        success_url: successUrl,
        cancel_url: cancelUrl,
      };
      if (env.STRIPE_AUTOMATIC_TAX) params.customer_update = { address: 'auto', name: 'auto' };
      const session = await this.stripe.checkout.sessions.create(params, { idempotencyKey });
      return { id: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000) };
    });
  }

  async expireCheckoutSession(id) {
    try {
      await this.stripe.checkout.sessions.expire(id);
      return true;
    } catch (err) {
      // Already completed or expired — nothing to expire.
      return false;
    }
  }

  async retrieveCheckoutSession(id) {
    return this.call(async () => this.stripe.checkout.sessions.retrieve(id));
  }

  async listCheckoutSessionsForPaymentLink(paymentLinkId) {
    return this.call(async () => (await this.stripe.checkout.sessions.list({ payment_link: paymentLinkId, limit: 20 })).data);
  }

  async listInvoices(customerId) {
    return this.call(async () => (await this.stripe.invoices.list({ customer: customerId, limit: 24 })).data);
  }

  async listSubscriptions(customerId) {
    return this.call(async () => {
      // Stripe allows at most 4 expansion levels, so a list can expand the
      // price but not its product — product names are fetched in one call.
      const subs = (await this.stripe.subscriptions.list({
        customer: customerId, status: 'all', limit: 20, expand: ['data.items.data.price'],
      })).data;
      const productIds = [...new Set(subs.flatMap((s) => (s.items?.data || [])
        .map((i) => i.price?.product).filter((p) => typeof p === 'string')))];
      if (productIds.length) {
        const products = new Map();
        for (let i = 0; i < productIds.length; i += 100) {
          const page = await this.stripe.products.list({ ids: productIds.slice(i, i + 100), limit: 100 });
          for (const product of page.data) products.set(product.id, product);
        }
        for (const sub of subs) {
          for (const item of sub.items?.data || []) {
            if (item.price && typeof item.price.product === 'string' && products.has(item.price.product)) {
              item.price.product = products.get(item.price.product);
            }
          }
        }
      }
      return subs;
    });
  }

  async retrieveSubscription(id) {
    return this.call(async () => this.stripe.subscriptions.retrieve(id, { expand: ['items.data.price.product'] }));
  }

  verifyAndParseWebhookEvent(rawBody, signatureHeader) {
    const event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    return {
      id: event.id, type: event.type, data: event.data, created: event.created, livemode: event.livemode,
    };
  }

  async createCustomerPortalSession({ stripeCustomerId, returnUrl }) {
    return this.call(async () => {
      const session = await this.stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: returnUrl });
      return { url: session.url };
    });
  }
}

/**
 * Development stand-in: keeps customers, prices and links in memory so the
 * whole sales flow can be exercised without a Stripe account. The catalog
 * is built from the active internal service plans.
 */
class MockStripeAdapter extends StripeAdapter {
  constructor() {
    super();
    this.customers = new Map();
    this.customPrices = new Map();
    this.sessions = new Map();
  }

  get mode() { return 'mock'; }

  get configured() { return true; }

  // eslint-disable-next-line class-methods-use-this
  async getAccount() {
    return {
      id: 'mock_acct', name: 'Mock Stripe (development — no real payments)', defaultCurrency: 'usd', country: null, error: null,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async ping() { return true; }

  async searchCustomers(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    return [...this.customers.values()].filter((c) => [c.name, c.email, c.phone, c.id].some((v) => v && v.toLowerCase().includes(q)));
  }

  async retrieveCustomer(id) {
    return this.customers.get(id) || null;
  }

  async listAllCustomers() {
    return { customers: [...this.customers.values()], truncated: false };
  }

  async createCustomer({
    name, email, phone, address, metadata,
  }) {
    const customer = {
      id: `mock_cus_${crypto.randomUUID().slice(0, 12)}`, name: name || null, email: email || null, phone: phone || null, address: address || null, created: new Date().toISOString(), metadata: metadata || {}, livemode: false,
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  async updateCustomer(id, fields) {
    const customer = this.customers.get(id);
    if (!customer) {
      const err = new Error('Stripe: No such customer');
      err.statusCode = 422;
      throw err;
    }
    Object.assign(customer, fields);
    return customer;
  }

  async listPrices() {
    // eslint-disable-next-line global-require
    const { ServicePlan } = require('../../../models');
    const plans = await ServicePlan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] });
    const catalog = plans.map((plan) => ({
      id: plan.stripePriceId && plan.stripePriceId.startsWith('mock_') ? plan.stripePriceId : `mock_price_${plan.key}`,
      productId: `mock_prod_${plan.key}`,
      productName: plan.name,
      productDescription: null,
      productActive: true,
      nickname: null,
      unitAmount: plan.amountCents,
      currency: 'usd',
      type: plan.priceType === 'recurring' ? 'recurring' : 'one_time',
      interval: plan.priceType === 'recurring' ? (plan.billingInterval || 'month') : null,
      intervalCount: plan.priceType === 'recurring' ? 1 : null,
      lookupKey: null,
      isCustomOffer: false,
    }));
    return [...catalog, ...this.customPrices.values()];
  }

  async retrievePrices(ids) {
    const all = await this.listPrices();
    return ids.map((id) => {
      const price = all.find((p) => p.id === id);
      if (!price) {
        const err = new Error(`Stripe: No such price: ${id}`);
        err.statusCode = 422;
        throw err;
      }
      return price;
    });
  }

  async findOrCreateCustomPrice(offer) {
    const lookupKey = customPriceLookupKey(offer);
    if (!this.customPrices.has(lookupKey)) {
      this.customPrices.set(lookupKey, {
        id: `mock_price_${lookupKey.slice(10, 22)}`,
        productId: `mock_prod_${lookupKey.slice(10, 22)}`,
        productName: offer.name,
        productDescription: null,
        productActive: true,
        nickname: null,
        unitAmount: offer.amountCents,
        currency: offer.currency,
        type: offer.interval ? 'recurring' : 'one_time',
        interval: offer.interval || null,
        intervalCount: offer.interval ? 1 : null,
        lookupKey,
        isCustomOffer: true,
      });
    }
    return this.customPrices.get(lookupKey);
  }

  // eslint-disable-next-line class-methods-use-this
  async createPaymentLink() {
    const id = `mock_plink_${crypto.randomUUID().slice(0, 12)}`;
    return { id, url: `https://mock.stripe.test/pay/${id}`, expiresAt: null };
  }

  // eslint-disable-next-line class-methods-use-this
  async deactivatePaymentLink() { return true; }

  async createCheckoutSession({ expiresAt, customerId }) {
    const id = `mock_cs_${crypto.randomUUID().slice(0, 12)}`;
    this.sessions.set(id, { id, customer: customerId, status: 'open' });
    return { id, url: `https://mock.stripe.test/checkout/${id}`, expiresAt };
  }

  async expireCheckoutSession(id) {
    const session = this.sessions.get(id);
    if (session) session.status = 'expired';
    return true;
  }

  // eslint-disable-next-line class-methods-use-this
  async retrieveCheckoutSession(id) { return { id, status: 'open', payment_status: 'unpaid' }; }

  // eslint-disable-next-line class-methods-use-this
  async listCheckoutSessionsForPaymentLink() { return []; }

  // eslint-disable-next-line class-methods-use-this
  async listInvoices() { return []; }

  // eslint-disable-next-line class-methods-use-this
  async listSubscriptions() { return []; }

  // eslint-disable-next-line class-methods-use-this
  async retrieveSubscription() { return null; }

  // eslint-disable-next-line class-methods-use-this
  verifyAndParseWebhookEvent(rawBody) {
    // No real signature in mock mode. The HTTP route mounts express.raw(),
    // so rawBody is a Buffer; tests may pass a JSON string or an object.
    let text = rawBody;
    if (Buffer.isBuffer(text)) text = text.toString('utf8');
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    return {
      id: parsed.id, type: parsed.type, data: parsed.data, created: parsed.created || Math.floor(Date.now() / 1000), livemode: false,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async createCustomerPortalSession({ stripeCustomerId }) {
    return { url: `https://mock.stripe.test/portal/${stripeCustomerId}` };
  }

  /** Dev/test helper — a checkout.session.completed event like a real paid checkout. */
  // eslint-disable-next-line class-methods-use-this
  buildCheckoutCompletedEvent({
    opportunityId, agencyOrganizationId, paymentRequestId, stripeCustomerId, stripeSubscriptionId, stripePaymentLinkId,
    stripeCheckoutSessionId, amountTotal, currency, mode, eventId, paymentStatus,
  }) {
    const subscriptionMode = mode ? mode === 'subscription' : stripeSubscriptionId !== null;
    return {
      id: eventId || `mock_evt_${crypto.randomUUID()}`,
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: stripeCheckoutSessionId || `mock_cs_${crypto.randomUUID()}`,
          object: 'checkout.session',
          mode: subscriptionMode ? 'subscription' : 'payment',
          customer: stripeCustomerId || `mock_cus_${crypto.randomUUID()}`,
          subscription: subscriptionMode ? (stripeSubscriptionId || `mock_sub_${crypto.randomUUID()}`) : null,
          invoice: subscriptionMode ? `mock_in_${crypto.randomUUID()}` : null,
          payment_intent: subscriptionMode ? null : `mock_pi_${crypto.randomUUID()}`,
          payment_link: stripePaymentLinkId || null,
          payment_status: paymentStatus || 'paid',
          amount_total: amountTotal === undefined ? 10000 : amountTotal,
          currency: currency || 'usd',
          livemode: false,
          metadata: {
            leadzaroOpportunityId: opportunityId,
            leadzaroAgencyOrganizationId: agencyOrganizationId,
            ...(paymentRequestId ? { leadzaroPaymentRequestId: paymentRequestId } : {}),
          },
        },
      },
    };
  }

  /** Dev/test helper — a synthetic invoice event (snake_case, unix seconds). */
  // eslint-disable-next-line class-methods-use-this
  buildInvoiceEvent({
    type, stripeSubscriptionId, stripeCustomerId, periodStart, periodEnd, eventId, amountPaid, billingReason,
  }) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      id: eventId || `mock_evt_${crypto.randomUUID()}`,
      type,
      created: nowSeconds,
      data: {
        object: {
          id: `mock_in_${crypto.randomUUID()}`,
          object: 'invoice',
          customer: stripeCustomerId || `mock_cus_${crypto.randomUUID()}`,
          subscription: stripeSubscriptionId === undefined ? `mock_sub_${crypto.randomUUID()}` : stripeSubscriptionId,
          billing_reason: billingReason || 'subscription_cycle',
          amount_paid: amountPaid === undefined ? 0 : amountPaid,
          currency: 'usd',
          period_start: periodStart || nowSeconds,
          period_end: periodEnd || nowSeconds + 30 * 24 * 60 * 60,
          status_transitions: { paid_at: nowSeconds },
        },
      },
    };
  }

  /** Dev/test helper — a synthetic customer.subscription.* event. */
  // eslint-disable-next-line class-methods-use-this
  buildSubscriptionEvent({
    type, stripeSubscriptionId, stripeCustomerId, status, currentPeriodStart, currentPeriodEnd, eventId,
  }) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      id: eventId || `mock_evt_${crypto.randomUUID()}`,
      type,
      created: nowSeconds,
      data: {
        object: {
          id: stripeSubscriptionId || `mock_sub_${crypto.randomUUID()}`,
          object: 'subscription',
          customer: stripeCustomerId || `mock_cus_${crypto.randomUUID()}`,
          status: status || 'active',
          current_period_start: currentPeriodStart || nowSeconds,
          current_period_end: currentPeriodEnd || nowSeconds + 30 * 24 * 60 * 60,
        },
      },
    };
  }
}

class DisabledStripeAdapter extends StripeAdapter {}
for (const method of ['getAccount', 'ping', 'searchCustomers', 'retrieveCustomer', 'listAllCustomers', 'createCustomer', 'updateCustomer', 'listPrices', 'retrievePrices',
  'findOrCreateCustomPrice', 'createPaymentLink', 'deactivatePaymentLink', 'createCheckoutSession', 'expireCheckoutSession', 'retrieveCheckoutSession',
  'listCheckoutSessionsForPaymentLink', 'listInvoices', 'listSubscriptions', 'retrieveSubscription', 'createCustomerPortalSession']) {
  DisabledStripeAdapter.prototype[method] = async function disabled() { throw notConfigured(); };
}
DisabledStripeAdapter.prototype.verifyAndParseWebhookEvent = function disabled() { throw notConfigured(); };

let cachedAdapter = null;

function getStripeAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.STRIPE_PROVIDER === 'live' && env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.includes('placeholder')) {
    cachedAdapter = new LiveStripeAdapter(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
    return cachedAdapter;
  }

  if (env.STRIPE_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: STRIPE_PROVIDER=mock is set in production — no real payments will be processed and all Stripe ids will be fake.');
    }
    cachedAdapter = new MockStripeAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledStripeAdapter();
  return cachedAdapter;
}

module.exports = {
  getStripeAdapter, StripeAdapter, LiveStripeAdapter, MockStripeAdapter, DisabledStripeAdapter, customPriceLookupKey,
};

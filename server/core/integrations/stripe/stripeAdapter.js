'use strict';

const crypto = require('node:crypto');
const { env } = require('../../config/env');

/**
 * Stripe provider interface. No real test-mode credentials exist in
 * this environment yet (see .env.example) — the adapter boundary is
 * what lets a real Stripe SDK call be dropped in later without touching
 * call sites, per the standing external-services rule. Every method
 * returns a small, normalized shape; callers never touch the Stripe SDK
 * or its raw response objects directly.
 */
class StripeAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createPaymentLink({
    priceIds, opportunityId, agencyOrganizationId, metadata,
  }) {
    throw new Error('StripeAdapter.createPaymentLink must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  verifyAndParseWebhookEvent(rawBody, signatureHeader) {
    throw new Error('StripeAdapter.verifyAndParseWebhookEvent must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createCustomerPortalSession({ stripeCustomerId, returnUrl }) {
    throw new Error('StripeAdapter.createCustomerPortalSession must be implemented by a subclass');
  }
}

/**
 * Real Stripe SDK-backed implementation. Untestable in this environment
 * (no real test-mode keys), but structurally complete and ready to use
 * the moment credentials are configured — never a silent no-op.
 */
class LiveStripeAdapter extends StripeAdapter {
  constructor(secretKey, webhookSecret) {
    super();
    // eslint-disable-next-line global-require
    const Stripe = require('stripe');
    this.stripe = new Stripe(secretKey);
    this.webhookSecret = webhookSecret;
  }

  async createPaymentLink({
    priceIds, opportunityId, agencyOrganizationId, metadata = {},
  }) {
    const link = await this.stripe.paymentLinks.create({
      line_items: priceIds.map((price) => ({ price, quantity: 1 })),
      metadata: {
        leadzaroOpportunityId: opportunityId,
        leadzaroAgencyOrganizationId: agencyOrganizationId,
        ...metadata,
      },
    });
    return { id: link.id, url: link.url };
  }

  verifyAndParseWebhookEvent(rawBody, signatureHeader) {
    const event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
    return { id: event.id, type: event.type, data: event.data };
  }

  async createCustomerPortalSession({ stripeCustomerId, returnUrl }) {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }
}

/**
 * Simulates Payment Link creation and lets tests/dev synthesize a
 * matching webhook event, without any real network call. Every id it
 * returns is clearly prefixed `mock_` so it can never be confused with
 * a real Stripe id in logs or the database.
 */
class MockStripeAdapter extends StripeAdapter {
  // eslint-disable-next-line class-methods-use-this
  async createPaymentLink({
    priceIds, opportunityId, agencyOrganizationId, metadata = {},
  }) {
    const id = `mock_pl_${crypto.randomUUID()}`;
    return {
      id,
      url: `https://mock.stripe.test/pay/${id}`,
      metadata: { leadzaroOpportunityId: opportunityId, leadzaroAgencyOrganizationId: agencyOrganizationId, ...metadata },
    };
  }

  // eslint-disable-next-line class-methods-use-this
  verifyAndParseWebhookEvent(rawBody) {
    // No real signature to verify in mock mode. The real HTTP route
    // mounts express.raw(), so rawBody is a Buffer in production/dev
    // traffic; tests calling this directly may pass a JSON string or an
    // already-parsed object — handle all three rather than silently
    // treating a Buffer as if it were the parsed event.
    let text = rawBody;
    if (Buffer.isBuffer(text)) text = text.toString('utf8');
    const parsed = typeof text === 'string' ? JSON.parse(text) : text;
    return { id: parsed.id, type: parsed.type, data: parsed.data };
  }

  // eslint-disable-next-line class-methods-use-this
  async createCustomerPortalSession({ stripeCustomerId }) {
    return { url: `https://mock.stripe.test/portal/${stripeCustomerId}` };
  }

  /** Test/dev helper only — builds a synthetic checkout.session.completed
   * event carrying the same metadata a real Payment Link checkout would. */
  // eslint-disable-next-line class-methods-use-this
  buildCheckoutCompletedEvent({
    opportunityId, agencyOrganizationId, stripeCustomerId, stripeSubscriptionId, eventId,
  }) {
    return {
      id: eventId || `mock_evt_${crypto.randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `mock_cs_${crypto.randomUUID()}`,
          customer: stripeCustomerId || `mock_cus_${crypto.randomUUID()}`,
          subscription: stripeSubscriptionId || `mock_sub_${crypto.randomUUID()}`,
          metadata: { leadzaroOpportunityId: opportunityId, leadzaroAgencyOrganizationId: agencyOrganizationId },
        },
      },
    };
  }
}

class DisabledStripeAdapter extends StripeAdapter {
  // eslint-disable-next-line class-methods-use-this
  async createPaymentLink() {
    const err = new Error('Stripe is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  verifyAndParseWebhookEvent() {
    const err = new Error('Stripe is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async createCustomerPortalSession() {
    const err = new Error('Stripe is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }
}

let cachedAdapter = null;

function getStripeAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.STRIPE_PROVIDER === 'live') {
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
  getStripeAdapter, StripeAdapter, LiveStripeAdapter, MockStripeAdapter, DisabledStripeAdapter,
};

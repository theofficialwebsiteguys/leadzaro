'use strict';

const crypto = require('node:crypto');
const {
  sequelize, Opportunity, PaymentLinkRequest, ServicePlan, User,
} = require('../../models');
const { env } = require('../../core/config/env');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');
const { recordAudit } = require('../../core/audit/auditService');
const stripeService = require('./stripeService');
const paymentEvents = require('./paymentEventsService');
const { isForward } = require('../../core/crm/pipelineCatalog');
const {
  invalid, isUniqueViolation, appUrl, formatMoney,
} = require('./salesCommon');

/**
 * Payment requests (ADR 0011): a real Stripe Payment Link (shareable) or
 * a Checkout Session bound to the business's Stripe customer (expires and
 * can be regenerated). Every request records the terms, Stripe
 * references, who created it and who the sale is credited to. The
 * caller's idempotency key makes a double submit return the same request.
 */

const OPEN_STATUSES = ['created', 'sent', 'processing'];
const INTERVALS = ['month', 'year'];

function describeTerms(lineItems) {
  const oneTime = lineItems.filter((i) => !i.interval);
  const recurring = lineItems.filter((i) => i.interval);
  const currency = lineItems[0]?.currency;
  const recurringAmount = recurring.reduce((sum, i) => sum + i.unitAmount, 0);
  const initialAmount = lineItems.reduce((sum, i) => sum + i.unitAmount, 0);
  const intervals = [...new Set(recurring.map((i) => i.interval))];
  if (intervals.length > 1) throw invalid('Monthly and yearly prices can’t be combined in one payment — make two separate requests.');
  if (new Set(lineItems.map((i) => i.currency)).size > 1) throw invalid('All items must use the same currency.');
  if (initialAmount <= 0) throw invalid('The amount due today must be more than $0 — a sale is only won when money is received.');
  return {
    currency,
    initialAmountCents: initialAmount,
    recurringAmountCents: recurringAmount || null,
    recurringInterval: intervals[0] || null,
    setupAmountCents: oneTime.reduce((sum, i) => sum + i.unitAmount, 0),
  };
}

function toLineItem(price, source) {
  return {
    priceId: price.id,
    productId: price.productId,
    name: price.nickname ? `${price.productName} — ${price.nickname}` : price.productName,
    unitAmount: price.unitAmount,
    currency: price.currency,
    interval: price.type === 'recurring' ? price.interval : null,
    source,
  };
}

async function resolveLineItems(ctx, { priceIds = [], customItems = [] }) {
  const adapter = getStripeAdapter();
  const unique = [...new Set(priceIds.map(String))];
  if (unique.length + customItems.length === 0) throw invalid('Choose at least one product or price.');
  if (unique.length + customItems.length > 10) throw invalid('Use at most 10 items in one payment request.');

  const items = [];
  if (unique.length) {
    const prices = await adapter.retrievePrices(unique);
    for (const price of prices) {
      if (price.unitAmount === null || price.unitAmount === undefined) throw invalid(`${price.productName} has no fixed price and can’t be used here.`);
      if (price.type === 'recurring' && price.intervalCount && price.intervalCount !== 1) throw invalid(`${price.productName} bills every ${price.intervalCount} ${price.interval}s, which isn’t supported here.`);
      items.push(toLineItem(price, 'catalog'));
    }
  }

  if (customItems.length) {
    if (!ctx.can('payments.custom_offer')) throw invalid('You don’t have permission to create custom-priced offers. Choose a product from the Stripe catalog or ask a manager.', 403);
    for (const custom of customItems) {
      const name = String(custom.name || '').trim().slice(0, 120);
      const amountCents = Number(custom.amountCents);
      const interval = custom.interval || null;
      if (!name) throw invalid('Each custom item needs a name.');
      if (!Number.isInteger(amountCents) || amountCents < 50) throw invalid('Custom amounts must be at least $0.50.');
      if (amountCents > 10000000) throw invalid('That custom amount looks too large — check it and try again.');
      if (interval && !INTERVALS.includes(interval)) throw invalid('Custom recurring items must be monthly or yearly.');
      const currency = String(custom.currency || items[0]?.currency || env.STRIPE_DEFAULT_CURRENCY).toLowerCase();
      const price = await adapter.findOrCreateCustomPrice({
        name, amountCents, currency, interval,
      });
      items.push(toLineItem(price, 'custom'));
    }
  }
  return items;
}

function metadataFor(request, opportunity) {
  return {
    leadzaroPaymentRequestId: request.id,
    leadzaroOpportunityId: opportunity.id,
    leadzaroAgencyOrganizationId: opportunity.agencyOrganizationId,
    leadzaroOrganizationId: opportunity.organizationId,
  };
}

async function callStripe(request, opportunity, customerId) {
  const adapter = getStripeAdapter();
  const lineItems = request.lineItems.map((item) => ({ priceId: item.priceId, quantity: 1 }));
  const recurring = Boolean(request.recurringInterval);
  const metadata = metadataFor(request, opportunity);
  if (request.kind === 'checkout_session') {
    const expiresAt = new Date(Date.now() + env.STRIPE_CHECKOUT_EXPIRY_HOURS * 3600 * 1000 - 60 * 1000);
    return adapter.createCheckoutSession({
      customerId,
      lineItems,
      recurring,
      metadata,
      expiresAt,
      successUrl: appUrl('/payment/thanks'),
      cancelUrl: appUrl('/payment/thanks?cancelled=1'),
      idempotencyKey: `lz-plr-${request.id}`,
    });
  }
  return adapter.createPaymentLink({
    lineItems, recurring, metadata, idempotencyKey: `lz-plr-${request.id}`,
  });
}

async function loadOpportunity(ctx, opportunityId, { lock = null } = {}) {
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null }, ...(lock ? { lock: lock.LOCK.UPDATE, transaction: lock } : {}) });
  if (!opportunity) throw invalid('Lead not found', 404);
  return opportunity;
}

async function moveToAwaitingPayment(opportunity, ctx) {
  const updates = {};
  if (isForward(opportunity.stage, 'awaiting_payment')) {
    updates.stage = 'awaiting_payment';
    updates.stageChangedAt = new Date();
  }
  if (!opportunity.nextActionAt) {
    updates.nextActionAt = new Date(Date.now() + 2 * 86400000);
    updates.nextActionType = 'payment_follow_up';
    updates.nextActionNote = 'Check the payment link was received and paid';
  }
  if (Object.keys(updates).length) {
    const from = opportunity.stage;
    await opportunity.update(updates);
    if (updates.stage) {
      await recordAudit({
        organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'opportunity.stage_changed', targetType: 'Opportunity', targetId: opportunity.id, metadata: { from, to: updates.stage, reason: 'payment_request_created' }, req: ctx.req,
      });
    }
  }
}

function present(request) {
  const json = request.toJSON ? request.toJSON() : request;
  const expired = json.kind === 'checkout_session' && json.expiresAt && new Date(json.expiresAt) < new Date() && OPEN_STATUSES.includes(json.status);
  return {
    ...json,
    status: expired ? 'expired' : json.status,
    isOpen: OPEN_STATUSES.includes(json.status) && !expired,
    url: json.stripePaymentLinkUrl,
  };
}

async function listForOpportunity(ctx, opportunityId) {
  await loadOpportunity(ctx, opportunityId);
  const requests = await PaymentLinkRequest.findAll({
    where: { opportunityId, agencyOrganizationId: ctx.agencyId },
    include: [
      { model: ServicePlan, as: 'servicePlan' },
      { model: User, as: 'createdBy', attributes: ['id', 'name'] },
      { model: User, as: 'attributedTo', attributes: ['id', 'name'] },
    ],
    order: [['createdAt', 'DESC']],
  });
  return requests.map(present);
}

/**
 * Creates the Leadzaro record first (holding the idempotency key and the
 * terms), then the Stripe object, using the record id as Stripe's own
 * idempotency key. A Stripe failure leaves a `failed` record with the
 * reason, never a half-created link.
 */
async function createRequest(ctx, opportunityId, input) {
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9-]{8,100}$/.test(idempotencyKey)) throw invalid('Missing request key — reload the page and try again.');
  const prior = await PaymentLinkRequest.findOne({ where: { idempotencyKey } });
  if (prior) {
    if (prior.agencyOrganizationId !== ctx.agencyId || prior.opportunityId !== opportunityId) throw invalid('Request key already used', 409);
    return present(prior);
  }

  const adapter = getStripeAdapter();
  if (!adapter.configured) throw invalid('Stripe is not connected. Ask an administrator to connect it in Settings.', 503);
  const opportunity = await loadOpportunity(ctx, opportunityId);
  if (opportunity.stage === 'won') throw invalid('This deal is already won. Start a new deal for this business to sell something else.', 409);
  if (opportunity.archivedAt) throw invalid('Restore this lead before requesting a payment.', 409);

  const kind = input.delivery === 'checkout' ? 'checkout_session' : 'payment_link';
  let customerId = null;
  if (kind === 'checkout_session') {
    const link = await stripeService.activeLink(ctx.agencyId, opportunity.organizationId);
    if (!link) throw invalid('Link or create the Stripe customer first — a customer checkout is tied to their Stripe account.', 409);
    customerId = link.stripeCustomerId;
  }

  const lineItems = await resolveLineItems(ctx, { priceIds: input.priceIds || [], customItems: input.customItems || [] });
  const terms = describeTerms(lineItems);
  const offerTitle = String(input.offerTitle || lineItems.map((i) => i.name).join(' + ')).trim().slice(0, 200);

  let request;
  try {
    request = await PaymentLinkRequest.create({
      opportunityId,
      agencyOrganizationId: ctx.agencyId,
      organizationId: opportunity.organizationId,
      servicePlanId: null,
      addOnServicePlanIds: [],
      kind,
      status: 'creating',
      stripeMode: adapter.mode,
      stripeCustomerId: customerId,
      currency: terms.currency,
      initialAmountCents: terms.initialAmountCents,
      recurringAmountCents: terms.recurringAmountCents,
      recurringInterval: terms.recurringInterval,
      lineItems,
      offerTitle,
      idempotencyKey,
      attributedUserId: opportunity.assignedToUserId || ctx.userId,
      createdByUserId: ctx.userId,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await PaymentLinkRequest.findOne({ where: { idempotencyKey } });
      if (existing) return present(existing);
    }
    throw err;
  }

  try {
    const created = await callStripe(request, opportunity, customerId);
    await request.update({
      status: 'created',
      stripePaymentLinkId: kind === 'payment_link' ? created.id : null,
      stripeCheckoutSessionId: kind === 'checkout_session' ? created.id : null,
      stripePaymentLinkUrl: created.url,
      expiresAt: created.expiresAt || null,
    });
  } catch (err) {
    await request.update({ status: 'failed', lastError: String(err.message).slice(0, 500) });
    throw err;
  }

  if (!opportunity.valueCents) await opportunity.update({ valueCents: terms.initialAmountCents, currency: terms.currency });
  await moveToAwaitingPayment(opportunity, ctx);
  await recordAudit({
    organizationId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: 'payment_request.created',
    targetType: 'Opportunity',
    targetId: opportunityId,
    metadata: {
      paymentRequestId: request.id, kind, mode: adapter.mode, initialAmountCents: terms.initialAmountCents, recurringAmountCents: terms.recurringAmountCents, currency: terms.currency,
    },
    req: ctx.req,
  });
  return present(request);
}

async function loadRequest(ctx, requestId) {
  const request = await PaymentLinkRequest.findOne({ where: { id: requestId, agencyOrganizationId: ctx.agencyId } });
  if (!request) throw invalid('Payment request not found', 404);
  return request;
}

/** Only an explicit action marks a link as sent — copying it does not. */
async function markSent(ctx, requestId, via) {
  const request = await loadRequest(ctx, requestId);
  if (!OPEN_STATUSES.includes(request.status)) throw invalid('Only an open payment request can be marked as sent.', 409);
  const channel = ['email', 'sms', 'in_person', 'other'].includes(via) ? via : 'other';
  await request.update({
    status: request.status === 'created' ? 'sent' : request.status, sentAt: new Date(), sentVia: channel, sentByUserId: ctx.userId,
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'payment_request.marked_sent', targetType: 'PaymentLinkRequest', targetId: request.id, metadata: { via: channel }, req: ctx.req,
  });
  return present(request);
}

async function deactivate(ctx, requestId) {
  const request = await loadRequest(ctx, requestId);
  if (!OPEN_STATUSES.includes(request.status) && request.status !== 'expired') throw invalid('This payment request is no longer open.', 409);
  const adapter = getStripeAdapter();
  if (request.kind === 'checkout_session' && request.stripeCheckoutSessionId) await adapter.expireCheckoutSession(request.stripeCheckoutSessionId);
  if (request.kind === 'payment_link' && request.stripePaymentLinkId) await adapter.deactivatePaymentLink(request.stripePaymentLinkId);
  await request.update({ status: 'deactivated', deactivatedAt: new Date(), deactivatedByUserId: ctx.userId });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'payment_request.deactivated', targetType: 'PaymentLinkRequest', targetId: request.id, req: ctx.req,
  });
  return present(request);
}

/** A fresh customer checkout with the same terms; the old one is closed. */
async function regenerate(ctx, requestId, idempotencyKey) {
  const old = await loadRequest(ctx, requestId);
  if (old.kind !== 'checkout_session') throw invalid('Only customer checkouts expire and need regenerating — a payment link stays valid until you deactivate it.', 409);
  if (old.status === 'paid') throw invalid('This checkout was already paid.', 409);
  if (old.replacedByRequestId) {
    const replacement = await PaymentLinkRequest.findByPk(old.replacedByRequestId);
    if (replacement) return present(replacement);
  }
  const opportunity = await loadOpportunity(ctx, old.opportunityId);
  const link = await stripeService.activeLink(ctx.agencyId, opportunity.organizationId);
  if (!link) throw invalid('This business is no longer linked to a Stripe customer.', 409);
  const adapter = getStripeAdapter();
  if (old.stripeCheckoutSessionId) await adapter.expireCheckoutSession(old.stripeCheckoutSessionId);

  const key = String(idempotencyKey || crypto.randomUUID());
  const request = await sequelize.transaction(async (transaction) => {
    const fresh = await PaymentLinkRequest.create({
      ...Object.fromEntries(['opportunityId', 'agencyOrganizationId', 'organizationId', 'kind', 'currency', 'initialAmountCents', 'recurringAmountCents', 'recurringInterval', 'lineItems', 'offerTitle', 'attributedUserId'].map((f) => [f, old[f]])),
      addOnServicePlanIds: [],
      status: 'creating',
      stripeMode: adapter.mode,
      stripeCustomerId: link.stripeCustomerId,
      idempotencyKey: key,
      createdByUserId: ctx.userId,
    }, { transaction });
    await old.update({ status: old.status === 'paid' ? 'paid' : 'replaced', replacedByRequestId: fresh.id }, { transaction });
    return fresh;
  });
  try {
    const created = await callStripe(request, opportunity, link.stripeCustomerId);
    await request.update({
      status: 'created', stripeCheckoutSessionId: created.id, stripePaymentLinkUrl: created.url, expiresAt: created.expiresAt,
    });
  } catch (err) {
    await request.update({ status: 'failed', lastError: String(err.message).slice(0, 500) });
    throw err;
  }
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'payment_request.regenerated', targetType: 'PaymentLinkRequest', targetId: request.id, metadata: { replaces: old.id }, req: ctx.req,
  });
  return present(request);
}

/**
 * Targeted reconcile: asks Stripe directly whether this request was paid,
 * for when a webhook was missed. Uses the same idempotent payment path.
 */
async function refresh(ctx, requestId) {
  const request = await loadRequest(ctx, requestId);
  const adapter = getStripeAdapter();
  if (adapter.mode === 'mock') return { request: present(request), result: { note: 'Mock mode has nothing to refresh — use “Simulate payment”.' } };
  let sessions = [];
  if (request.kind === 'checkout_session' && request.stripeCheckoutSessionId) sessions = [await adapter.retrieveCheckoutSession(request.stripeCheckoutSessionId)];
  if (request.kind === 'payment_link' && request.stripePaymentLinkId) sessions = await adapter.listCheckoutSessionsForPaymentLink(request.stripePaymentLinkId);
  const results = [];
  for (const session of sessions) {
    if (session.status === 'complete') results.push(await paymentEvents.handleCheckoutSession(session, { source: 'reconcile' }));
    else if (session.status === 'expired' && request.kind === 'checkout_session') results.push(await paymentEvents.handleCheckoutExpired(session));
  }
  await request.reload();
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'payment_request.refreshed', targetType: 'PaymentLinkRequest', targetId: request.id, metadata: { sessionsChecked: sessions.length }, req: ctx.req,
  });
  return { request: present(request), result: { sessionsChecked: sessions.length, results } };
}

/**
 * Development only (STRIPE_PROVIDER=mock): pushes a synthetic paid checkout
 * through the real webhook pipeline so the whole flow can be tried
 * without a Stripe account. Refused in live/test mode and in production.
 */
async function simulatePayment(ctx, requestId) {
  const adapter = getStripeAdapter();
  if (adapter.mode !== 'mock' || env.IS_PRODUCTION) throw invalid('Simulated payments are only available in development mock mode.', 403);
  const request = await loadRequest(ctx, requestId);
  if (!OPEN_STATUSES.includes(request.status)) throw invalid('Only an open payment request can be paid.', 409);
  const event = adapter.buildCheckoutCompletedEvent({
    opportunityId: request.opportunityId,
    agencyOrganizationId: request.agencyOrganizationId,
    paymentRequestId: request.id,
    stripeCustomerId: request.stripeCustomerId || undefined,
    stripePaymentLinkId: request.stripePaymentLinkId || null,
    stripeCheckoutSessionId: request.stripeCheckoutSessionId || undefined,
    amountTotal: request.initialAmountCents,
    currency: request.currency,
    mode: request.recurringInterval ? 'subscription' : 'payment',
  });
  // eslint-disable-next-line global-require
  const { processWebhook } = require('../billing/webhookService');
  const outcome = await processWebhook(Buffer.from(JSON.stringify(event)), null);
  await request.reload();
  return { request: present(request), outcome };
}

/** Compatibility for the pre-ADR endpoint: a service plan mapped to a Stripe price. */
async function createFromServicePlan(ctx, opportunityId, { servicePlanId, addOnServicePlanIds = [] }) {
  const plans = await ServicePlan.findAll({ where: { id: [servicePlanId, ...addOnServicePlanIds], isActive: true } });
  if (plans.length !== 1 + addOnServicePlanIds.length) throw invalid('Unknown or inactive service plan');
  const adapter = getStripeAdapter();
  const priceIds = plans.map((p) => p.stripePriceId || (adapter.mode === 'mock' ? `mock_price_${p.key}` : null));
  if (priceIds.some((id) => !id)) throw invalid('One or more selected service plans have not been mapped to a Stripe price yet', 422);
  const request = await createRequest(ctx, opportunityId, { priceIds, delivery: 'payment_link', idempotencyKey: crypto.randomUUID() });
  await PaymentLinkRequest.update({ servicePlanId, addOnServicePlanIds }, { where: { id: request.id } });
  return PaymentLinkRequest.findByPk(request.id);
}

function termsLabel(request) {
  const parts = [`${formatMoney(request.initialAmountCents, request.currency)} today`];
  if (request.recurringAmountCents) parts.push(`then ${formatMoney(request.recurringAmountCents, request.currency)}/${request.recurringInterval}`);
  return parts.join(', ');
}

module.exports = {
  listForOpportunity,
  createRequest,
  markSent,
  deactivate,
  regenerate,
  refresh,
  simulatePayment,
  createFromServicePlan,
  describeTerms,
  termsLabel,
  OPEN_STATUSES,
};

'use strict';

const { WebhookEvent } = require('../../models');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');
const paymentEvents = require('../sales/paymentEventsService');

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err) {
  return err.name === 'SequelizeUniqueConstraintError' || err.parent?.code === POSTGRES_UNIQUE_VIOLATION;
}

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * One handler per Stripe event type Leadzaro acts on (ADR 0011). Every
 * handler is idempotent and safe against out-of-order delivery; events
 * for Stripe customers or checkouts that did not come from Leadzaro are
 * recorded as ignored, never as failures — the connected account may
 * have plenty of unrelated activity.
 */
const HANDLERS = {
  'checkout.session.completed': (event, ledger) => paymentEvents.handleCheckoutSession(event.data.object, { webhookEventId: ledger.id }),
  'checkout.session.async_payment_succeeded': (event, ledger) => paymentEvents.handleCheckoutSession(event.data.object, { webhookEventId: ledger.id }),
  'checkout.session.async_payment_failed': (event) => paymentEvents.handleCheckoutFailed(event.data.object),
  'checkout.session.expired': (event) => paymentEvents.handleCheckoutExpired(event.data.object),
  'invoice.paid': (event, ledger) => paymentEvents.handleInvoicePaid(event.data.object, { eventCreated: event.created, webhookEventId: ledger.id }),
  // Older endpoints were registered with this name; the invoice id keeps it to one record.
  'invoice.payment_succeeded': (event, ledger) => paymentEvents.handleInvoicePaid(event.data.object, { eventCreated: event.created, webhookEventId: ledger.id }),
  'invoice.payment_failed': (event) => paymentEvents.handleInvoiceFailed(event.data.object),
  'customer.subscription.created': (event) => paymentEvents.handleSubscriptionEvent(event.data.object, { eventCreated: event.created }),
  'customer.subscription.updated': (event) => paymentEvents.handleSubscriptionEvent(event.data.object, { eventCreated: event.created }),
  'customer.subscription.deleted': (event) => paymentEvents.handleSubscriptionEvent(event.data.object, { eventCreated: event.created, deleted: true }),
  'charge.refunded': (event) => paymentEvents.handleChargeRefunded(event.data.object),
};

/**
 * Processes a raw incoming Stripe webhook payload end-to-end. The
 * insert into the WebhookEvents ledger (keyed by the unique
 * stripeEventId) is the real idempotency guarantee, and it happens
 * *before* any side-effecting logic runs — which has a consequence
 * worth stating explicitly: once that insert succeeds, this function
 * never re-throws, even if the handling logic below fails unexpectedly.
 * If it did re-throw, the caller would return an error status, Stripe
 * would retry the same event, and that retry would immediately hit the
 * ledger's duplicate-suppression path and no-op — meaning a genuine
 * transient failure would become permanently unprocessed instead of
 * retried. A failure here is recorded as `status: 'failed'` on the
 * ledger row for a human to investigate (see `processWebhookEventById`
 * for the manual recovery path this makes necessary), not surfaced as
 * an HTTP error. Signature verification failures are the one exception:
 * they happen *before* any ledger row exists, so they do propagate as
 * an error.
 */
async function processWebhook(rawBody, signatureHeader) {
  const adapter = getStripeAdapter();
  let event;
  try {
    event = adapter.verifyAndParseWebhookEvent(rawBody, signatureHeader);
  } catch (err) {
    // No ledger row exists yet at this point, so this is the one case
    // where a real error (bad/missing signature) is expected to
    // propagate — Stripe should not retry an invalid signature, and 400
    // tells it so without leaking why to whoever actually sent this.
    err.statusCode = 400;
    throw err;
  }

  let webhookEvent;
  try {
    webhookEvent = await WebhookEvent.create({
      stripeEventId: event.id,
      eventType: event.type,
      payload: event.data,
      status: 'received',
      livemode: event.livemode === undefined ? null : Boolean(event.livemode),
      stripeCreatedAt: event.created ? new Date(event.created * 1000) : null,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { duplicate: true };
    throw err;
  }

  return dispatch(event, webhookEvent);
}

/**
 * Manual recovery path for a webhook event that failed processing (see
 * docs/leadzaro/current-phase-plan.md § 7a). `processWebhook`'s ledger
 * insert never lets Stripe's own retry reach a handler twice — once a
 * WebhookEvent row exists, a Stripe Dashboard "resend" redelivers the
 * same stripeEventId, which hits the ledger's unique-constraint dedupe
 * and returns without ever invoking the handler again. This bypasses
 * that dedupe entirely by operating on the already-stored row directly,
 * reconstructing the same `{id, type, data}` shape `dispatch` expects
 * from the three fields already persisted at delivery time. Restricted
 * to rows currently `status: 'failed'` — reprocessing a healthy
 * 'processed'/'ignored' event is never the right action here.
 */
async function processWebhookEventById(webhookEventId) {
  const webhookEvent = await WebhookEvent.findByPk(webhookEventId);
  if (!webhookEvent) throw invalid('Webhook event not found', 404);
  if (webhookEvent.status !== 'failed') {
    throw invalid('Only a failed webhook event can be reprocessed', 422);
  }

  const event = {
    id: webhookEvent.stripeEventId,
    type: webhookEvent.eventType,
    data: webhookEvent.payload,
    created: webhookEvent.stripeCreatedAt ? Math.floor(webhookEvent.stripeCreatedAt.getTime() / 1000) : undefined,
  };
  return dispatch(event, webhookEvent);
}

async function dispatch(event, webhookEvent) {
  const handler = HANDLERS[event.type];
  if (!handler) {
    await webhookEvent.update({ status: 'ignored', processedAt: new Date() });
    return { duplicate: false, status: 'ignored' };
  }

  try {
    const result = await handler(event, webhookEvent);
    if (result?.ignored) {
      // Kept for the record with the reason, e.g. a checkout from another app.
      await webhookEvent.update({ status: 'ignored', errorMessage: result.reason || null, processedAt: new Date() });
      return { duplicate: false, status: 'ignored' };
    }
    await webhookEvent.update({ status: 'processed', errorMessage: null, processedAt: new Date() });
    return { duplicate: false, status: 'processed' };
  } catch (err) {
    await webhookEvent.update({ status: 'failed', errorMessage: err.message, processedAt: new Date() });
    return { duplicate: false, status: 'failed' };
  }
}

module.exports = { processWebhook, processWebhookEventById };

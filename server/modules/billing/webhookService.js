'use strict';

const { WebhookEvent, PaymentLinkRequest, Subscription } = require('../../models');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');
const { convertOpportunityToClient, recordNeedsAttention } = require('./conversionService');
const { triggerClientInvitationIfNew } = require('./clientInvitationService');
const { ensureProjectForConversion } = require('../projects/projectService');

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
 * One handler per Stripe event type this app acts on. Every lifecycle
 * handler (everything except checkout.session.completed) matches by
 * `stripeSubscriptionId` only, per docs/leadzaro/current-phase-plan.md
 * § 2e/§ 7a — Payment Link metadata is not guaranteed to propagate past
 * the bootstrap checkout event.
 */
const HANDLERS = {
  'checkout.session.completed': handleCheckoutCompleted,
  'invoice.payment_succeeded': handleInvoicePaymentSucceeded,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'customer.subscription.updated': handleSubscriptionUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
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

  const event = { id: webhookEvent.stripeEventId, type: webhookEvent.eventType, data: webhookEvent.payload };
  return dispatch(event, webhookEvent);
}

async function dispatch(event, webhookEvent) {
  const handler = HANDLERS[event.type];
  if (!handler) {
    await webhookEvent.update({ status: 'ignored', processedAt: new Date() });
    return { duplicate: false, status: 'ignored' };
  }

  try {
    await handler(event, webhookEvent);
    await webhookEvent.update({ status: 'processed', errorMessage: null, processedAt: new Date() });
    return { duplicate: false, status: 'processed' };
  } catch (err) {
    await webhookEvent.update({ status: 'failed', errorMessage: err.message, processedAt: new Date() });
    return { duplicate: false, status: 'failed' };
  }
}

async function handleCheckoutCompleted(event, webhookEvent) {
  const session = event.data.object;
  const opportunityId = session.metadata?.leadzaroOpportunityId;
  const agencyOrganizationId = session.metadata?.leadzaroAgencyOrganizationId;

  if (!opportunityId || !agencyOrganizationId) {
    await recordNeedsAttention({
      source: 'webhook',
      webhookEventId: webhookEvent.id,
      failureReason: 'checkout.session.completed had no resolvable leadzaroOpportunityId/leadzaroAgencyOrganizationId metadata',
    });
    return;
  }

  // Resolve which service plan this checkout was for. An opportunity can
  // have more than one PaymentLinkRequest (a rep re-quoting a different
  // plan) — matching by "most recently created" would silently attach
  // the wrong plan/add-ons to the Subscription and flip the wrong link's
  // status if the customer paid an older link while a newer one also
  // exists. session.payment_link (real Stripe's own field identifying
  // exactly which Payment Link a checkout originated from) is the
  // correct match; falling back to "most recent" only when it's absent
  // (the mock adapter, unless a test explicitly supplies it).
  const linkRequest = session.payment_link
    ? await PaymentLinkRequest.findOne({ where: { opportunityId, agencyOrganizationId, stripePaymentLinkId: session.payment_link } })
    : await PaymentLinkRequest.findOne({ where: { opportunityId, agencyOrganizationId }, order: [['createdAt', 'DESC']] });

  let result;
  try {
    result = await convertOpportunityToClient({
      opportunityId,
      agencyOrganizationId,
      servicePlanId: linkRequest?.servicePlanId || null,
      addOnServicePlanIds: linkRequest?.addOnServicePlanIds || [],
      stripeCustomerId: session.customer || null,
      stripeSubscriptionId: session.subscription || null,
      source: 'webhook',
      webhookEventId: webhookEvent.id,
    });
  } catch (err) {
    await recordNeedsAttention({
      opportunityId, agencyOrganizationId, source: 'webhook', webhookEventId: webhookEvent.id, failureReason: err.message,
    });
    return;
  }

  // Best-effort past this point: the conversion itself already succeeded
  // and is real. A failure flipping the link's status or sending the
  // invitation must never retroactively mark this webhook event/
  // conversion as needs_attention — that would misrepresent a genuine
  // success as unresolved on the manager-facing worklist.
  if (linkRequest && !result.alreadyConverted) {
    try {
      await linkRequest.update({ status: 'paid' });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[billing] failed to flip PaymentLinkRequest ${linkRequest.id} to paid after a successful conversion:`, err.message);
    }
  }
  await triggerClientInvitationIfNew(result);
  await ensureProjectForConversion(result);
}

/**
 * A one-off Stripe invoice (no `subscription` at all) is a legitimate,
 * benign input unrelated to any subscription lifecycle — a no-op, not a
 * failure. An invoice that *does* reference a subscription but matches
 * no local `Subscription` row is different: either out-of-order webhook
 * delivery (Stripe does not guarantee delivery order) or an unknown
 * subscription, and is treated as a real failure for human review via
 * `processWebhookEventById` rather than silently dropped.
 */
async function findSubscriptionForInvoiceOrThrow(invoice) {
  if (!invoice.subscription) return null;
  const subscription = await Subscription.findOne({ where: { stripeSubscriptionId: invoice.subscription } });
  if (!subscription) {
    throw invalid(`No local Subscription found for stripeSubscriptionId ${invoice.subscription}`, 422);
  }
  return subscription;
}

async function handleInvoicePaymentSucceeded(event) {
  const invoice = event.data.object;
  const subscription = await findSubscriptionForInvoiceOrThrow(invoice);
  if (!subscription) return;

  await subscription.update({
    status: 'active',
    currentPeriodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : subscription.currentPeriodStart,
    currentPeriodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : subscription.currentPeriodEnd,
  });
}

async function handleInvoicePaymentFailed(event) {
  const invoice = event.data.object;
  const subscription = await findSubscriptionForInvoiceOrThrow(invoice);
  if (!subscription) return;

  await subscription.update({ status: 'past_due' });
}

async function findSubscriptionByStripeIdOrThrow(stripeSubscriptionId) {
  const subscription = await Subscription.findOne({ where: { stripeSubscriptionId } });
  if (!subscription) {
    throw invalid(`No local Subscription found for stripeSubscriptionId ${stripeSubscriptionId}`, 422);
  }
  return subscription;
}

async function handleSubscriptionUpdated(event) {
  const stripeSubscription = event.data.object;
  const subscription = await findSubscriptionByStripeIdOrThrow(stripeSubscription.id);

  await subscription.update({
    status: stripeSubscription.status,
    currentPeriodStart: stripeSubscription.current_period_start
      ? new Date(stripeSubscription.current_period_start * 1000) : subscription.currentPeriodStart,
    currentPeriodEnd: stripeSubscription.current_period_end
      ? new Date(stripeSubscription.current_period_end * 1000) : subscription.currentPeriodEnd,
  });
}

async function handleSubscriptionDeleted(event) {
  const stripeSubscription = event.data.object;
  const subscription = await findSubscriptionByStripeIdOrThrow(stripeSubscription.id);
  await subscription.update({ status: 'canceled' });
}

module.exports = { processWebhook, processWebhookEventById };

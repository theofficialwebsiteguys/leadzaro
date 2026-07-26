'use strict';

const { WebhookEvent, PaymentLinkRequest } = require('../../models');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');
const { convertOpportunityToClient, recordNeedsAttention } = require('./conversionService');

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err) {
  return err.name === 'SequelizeUniqueConstraintError' || err.parent?.code === POSTGRES_UNIQUE_VIOLATION;
}

const HANDLED_EVENT_TYPES = new Set(['checkout.session.completed']);

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
 * ledger row for a human to investigate, not surfaced as an HTTP error.
 * Signature verification failures are the one exception: they happen
 * *before* any ledger row exists, so they do propagate as an error.
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

  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    await webhookEvent.update({ status: 'ignored', processedAt: new Date() });
    return { duplicate: false, status: 'ignored' };
  }

  try {
    await handleCheckoutCompleted(event, webhookEvent);
    await webhookEvent.update({ status: 'processed', processedAt: new Date() });
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

  // Resolve which service plan this checkout was for, if it originated
  // from one of our own Payment Link requests.
  const linkRequest = await PaymentLinkRequest.findOne({
    where: { opportunityId, agencyOrganizationId },
    order: [['createdAt', 'DESC']],
  });

  try {
    await convertOpportunityToClient({
      opportunityId,
      agencyOrganizationId,
      servicePlanId: linkRequest?.servicePlanId || null,
      stripeCustomerId: session.customer || null,
      stripeSubscriptionId: session.subscription || null,
      source: 'webhook',
      webhookEventId: webhookEvent.id,
    });
  } catch (err) {
    await recordNeedsAttention({
      opportunityId, agencyOrganizationId, source: 'webhook', webhookEventId: webhookEvent.id, failureReason: err.message,
    });
  }
}

module.exports = { processWebhook };

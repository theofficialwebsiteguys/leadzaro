'use strict';

const { Op } = require('sequelize');
const {
  sequelize, Opportunity, Organization, PaymentLinkRequest, SalesPayment, Subscription, BillingAccount, StripeCustomerLink, ServicePlan,
} = require('../../models');
const { convertOpportunityToClient, recordNeedsAttention } = require('../billing/conversionService');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const handoffService = require('./handoffService');
const {
  invalid, isUniqueViolation, stripeMode, formatMoney, assertNoSecrets,
} = require('./salesCommon');

/**
 * Everything that happens when money actually arrives (ADR 0011).
 *
 * - A sale is Won only when an initial payment or deposit is received:
 *   a Stripe-confirmed payment, or an authorized manual payment. A verbal
 *   yes, a generated link, a checkout visit, a trial or a $0 checkout
 *   never moves a deal to Won.
 * - Each Stripe payment is recorded once (unique checkout session /
 *   payment intent / invoice ids), so duplicate or out-of-order webhooks
 *   and manual refreshes cannot double count.
 * - Renewals are recorded as recurring revenue, never as new sales.
 */

const STRIPE_ID_FIELDS = ['stripeCheckoutSessionId', 'stripePaymentIntentId', 'stripeInvoiceId'];

function idOf(value) {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id || null;
}

function invoiceSubscriptionId(invoice) {
  return idOf(invoice.subscription) || idOf(invoice.parent?.subscription_details?.subscription) || null;
}

function invoiceMetadata(invoice) {
  return invoice.parent?.subscription_details?.metadata || invoice.subscription_details?.metadata || invoice.metadata || {};
}

async function findRequest({ metadata = {}, checkoutSessionId, paymentLinkId }) {
  if (metadata.leadzaroPaymentRequestId) {
    const byId = await PaymentLinkRequest.findByPk(metadata.leadzaroPaymentRequestId);
    if (byId) return byId;
  }
  if (checkoutSessionId) {
    const bySession = await PaymentLinkRequest.findOne({ where: { stripeCheckoutSessionId: checkoutSessionId } });
    if (bySession) return bySession;
  }
  if (paymentLinkId) {
    const byLink = await PaymentLinkRequest.findOne({ where: { stripePaymentLinkId: paymentLinkId } });
    if (byLink) return byLink;
  }
  // Links created before ADR 0011 only carried the opportunity.
  if (metadata.leadzaroOpportunityId && metadata.leadzaroAgencyOrganizationId) {
    return PaymentLinkRequest.findOne({
      where: { opportunityId: metadata.leadzaroOpportunityId, agencyOrganizationId: metadata.leadzaroAgencyOrganizationId },
      order: [['createdAt', 'DESC']],
    });
  }
  return null;
}

/** The paying Stripe customer stays linked to the business, so conversion reuses it. */
async function linkPayingCustomer({ agencyOrganizationId, organizationId, stripeCustomerId, mode }) {
  if (!stripeCustomerId) return;
  const current = await StripeCustomerLink.findOne({ where: { agencyOrganizationId, organizationId, stripeMode: mode, archivedAt: null } });
  if (current) return;
  const elsewhere = await StripeCustomerLink.findOne({ where: { agencyOrganizationId, stripeCustomerId, archivedAt: null } });
  if (elsewhere) return;
  try {
    await StripeCustomerLink.create({
      agencyOrganizationId, organizationId, stripeCustomerId, stripeMode: mode, linkMethod: 'checkout',
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
}

async function servicePlanForRequest(request) {
  if (request?.servicePlanId) return request.servicePlanId;
  const priceIds = (request?.lineItems || []).map((item) => item.priceId).filter(Boolean);
  if (!priceIds.length) return null;
  const plan = await ServicePlan.findOne({ where: { stripePriceId: priceIds } });
  return plan?.id || null;
}

function subscriptionDetailsFor(request, mode) {
  if (!request?.recurringAmountCents) return { stripeMode: mode };
  const recurring = (request.lineItems || []).filter((item) => item.interval);
  return {
    stripeMode: mode,
    amountCents: request.recurringAmountCents,
    currency: request.currency,
    interval: request.recurringInterval,
    productName: recurring.map((item) => item.name).join(', ').slice(0, 255) || null,
  };
}

/**
 * Converts (or links) the client exactly once through the existing
 * conversion path, then runs the handoff. Never throws: failures surface
 * as a retryable handoff and a needs-attention conversion record.
 */
async function completeSale({
  opportunityId, agencyOrganizationId, payment, request = null, stripeSubscriptionId = null, source, webhookEventId = null, actorUserId = null,
}) {
  const opportunity = await Opportunity.findByPk(opportunityId);
  let conversion;
  try {
    conversion = await convertOpportunityToClient({
      opportunityId,
      agencyOrganizationId,
      servicePlanId: await servicePlanForRequest(request),
      addOnServicePlanIds: request?.addOnServicePlanIds || [],
      stripeCustomerId: payment.stripeCustomerId || null,
      stripeSubscriptionId: stripeSubscriptionId || payment.stripeSubscriptionId || null,
      subscriptionDetails: subscriptionDetailsFor(request, payment.stripeMode),
      creditedUserId: payment.attributedUserId,
      source,
      webhookEventId,
      actorUserId,
    });
  } catch (err) {
    await recordNeedsAttention({
      opportunityId, agencyOrganizationId, source, webhookEventId, failureReason: `Payment received but conversion failed: ${err.message}`,
    });
    if (opportunity) await handoffService.markConversionFailed(opportunity, `Payment received, but the client could not be set up: ${err.message}`);
    return { converted: false, error: err.message };
  }

  await handoffService.runAfterConversion({ opportunityId, conversion, actorUserId });

  const recipient = payment.attributedUserId || opportunity?.assignedToUserId;
  if (recipient && !conversion.alreadyConverted) {
    const organization = await Organization.findByPk(opportunity.organizationId);
    await notify({
      userId: recipient,
      organizationId: agencyOrganizationId,
      type: 'sales.payment_received',
      title: `Payment received — ${organization?.name || 'your deal'}`,
      body: `${formatMoney(payment.amountCents, payment.currency)} was ${payment.source === 'stripe' ? 'confirmed by Stripe' : 'recorded'}. The client has been created — finish the handoff in Leadzaro.`,
      data: { opportunityId },
    }).catch(() => null);
  }
  return { converted: true, alreadyConverted: conversion.alreadyConverted };
}

/**
 * Records one Stripe payment for a Leadzaro payment request (or a pre-ADR
 * link identified by opportunity metadata). Idempotent across webhook
 * retries, out-of-order delivery and manual refreshes.
 */
async function recordStripePayment({
  request, opportunityId, agencyOrganizationId, amountCents, currency, paidAt, ids, stripeCustomerId, stripeSubscriptionId,
  receiptUrl = null, invoiceUrl = null, livemode, webhookEventId = null, source = 'webhook',
}) {
  const oppId = request?.opportunityId || opportunityId;
  const agencyId = request?.agencyOrganizationId || agencyOrganizationId;
  if (!oppId || !agencyId) return { ignored: true, reason: 'Not a Leadzaro payment' };
  if (!amountCents || amountCents <= 0) return { ignored: true, reason: 'No money was collected ($0 or trial) — the deal stays in Awaiting Payment' };
  const mode = request?.stripeMode || (livemode ? 'live' : stripeMode());

  let payment = null;
  try {
    payment = await sequelize.transaction(async (transaction) => {
      const opportunity = await Opportunity.findOne({ where: { id: oppId, agencyOrganizationId: agencyId }, lock: transaction.LOCK.UPDATE, transaction });
      if (!opportunity) throw invalid('Opportunity for this payment was not found', 404);

      const keys = STRIPE_ID_FIELDS.filter((field) => ids[field]).map((field) => ({ [field]: ids[field] }));
      if (keys.length) {
        const existing = await SalesPayment.findOne({ where: { [Op.or]: keys }, transaction });
        if (existing) return null;
      }

      const earlierSale = await SalesPayment.findOne({ where: { opportunityId: oppId, kind: 'initial' }, transaction });
      const created = await SalesPayment.create({
        agencyOrganizationId: agencyId,
        organizationId: opportunity.organizationId,
        opportunityId: oppId,
        paymentLinkRequestId: request?.id || null,
        source: 'stripe',
        // A second payment through the same reusable link is not another sale.
        kind: earlierSale ? 'other' : 'initial',
        amountCents,
        currency: (currency || 'usd').toLowerCase(),
        paidAt: paidAt || new Date(),
        stripeMode: mode,
        stripeCustomerId: stripeCustomerId || null,
        stripeSubscriptionId: stripeSubscriptionId || null,
        ...Object.fromEntries(STRIPE_ID_FIELDS.map((field) => [field, ids[field] || null])),
        receiptUrl,
        invoiceUrl,
        attributedUserId: request?.attributedUserId || opportunity.assignedToUserId || null,
      }, { transaction });

      if (request && request.status !== 'paid') {
        await request.update({
          status: 'paid',
          paidAt: created.paidAt,
          amountPaidCents: amountCents,
          stripeCustomerId: stripeCustomerId || request.stripeCustomerId,
          stripeSubscriptionId: stripeSubscriptionId || request.stripeSubscriptionId,
          stripeInvoiceId: ids.stripeInvoiceId || request.stripeInvoiceId,
          stripePaymentIntentId: ids.stripePaymentIntentId || request.stripePaymentIntentId,
          stripeCheckoutSessionId: request.stripeCheckoutSessionId || ids.stripeCheckoutSessionId || null,
        }, { transaction });
      }
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { duplicate: true };
    throw err;
  }
  if (!payment) return { duplicate: true };

  const opportunity = await Opportunity.findByPk(oppId);
  await linkPayingCustomer({
    agencyOrganizationId: agencyId, organizationId: opportunity.organizationId, stripeCustomerId, mode,
  });

  if (payment.kind !== 'initial') return { recorded: true, kind: payment.kind };
  const result = await completeSale({
    opportunityId: oppId, agencyOrganizationId: agencyId, payment, request, stripeSubscriptionId, source, webhookEventId,
  });
  return { recorded: true, kind: 'initial', ...result };
}

/** A completed Checkout Session (from a Payment Link or a customer-bound checkout). */
async function handleCheckoutSession(session, { webhookEventId = null, source = 'webhook' } = {}) {
  const request = await findRequest({ metadata: session.metadata || {}, checkoutSessionId: session.id, paymentLinkId: idOf(session.payment_link) });
  const metadata = session.metadata || {};
  if (!request && !metadata.leadzaroOpportunityId) return { ignored: true, reason: 'Checkout did not come from Leadzaro' };

  if (session.payment_status === 'no_payment_required') {
    if (request && request.status !== 'paid') await request.update({ status: 'completed_no_payment', stripeSubscriptionId: idOf(session.subscription), stripeCustomerId: idOf(session.customer) });
    return { ignored: true, reason: 'No payment was required (trial or $0) — the deal stays in Awaiting Payment' };
  }
  if (session.payment_status !== 'paid') {
    // e.g. bank debits: money is not in yet; async_payment_succeeded follows.
    if (request && !['paid', 'processing'].includes(request.status)) await request.update({ status: 'processing', stripeCustomerId: idOf(session.customer) });
    return { ignored: true, reason: 'Payment is still processing' };
  }

  return recordStripePayment({
    request,
    opportunityId: metadata.leadzaroOpportunityId,
    agencyOrganizationId: metadata.leadzaroAgencyOrganizationId,
    amountCents: session.amount_total,
    currency: session.currency,
    paidAt: session.created ? new Date(session.created * 1000) : new Date(),
    ids: {
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: idOf(session.payment_intent),
      stripeInvoiceId: idOf(session.invoice),
    },
    stripeCustomerId: idOf(session.customer),
    stripeSubscriptionId: idOf(session.subscription),
    livemode: session.livemode,
    webhookEventId,
    source,
  });
}

async function handleCheckoutFailed(session) {
  const request = await findRequest({ metadata: session.metadata || {}, checkoutSessionId: session.id, paymentLinkId: idOf(session.payment_link) });
  if (request && request.status !== 'paid') await request.update({ status: 'failed', lastError: 'The customer’s payment failed' });
  return { updated: Boolean(request) };
}

async function handleCheckoutExpired(session) {
  const request = await PaymentLinkRequest.findOne({ where: { stripeCheckoutSessionId: session.id } });
  if (request && ['created', 'sent', 'processing'].includes(request.status)) await request.update({ status: 'expired' });
  return { updated: Boolean(request) };
}

async function billingAccountForCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const link = await StripeCustomerLink.findOne({ where: { stripeCustomerId, archivedAt: null } });
  if (link) {
    const [account] = await BillingAccount.findOrCreate({ where: { organizationId: link.organizationId }, defaults: { organizationId: link.organizationId, stripeCustomerId, status: 'active' } });
    return { account, link };
  }
  const account = await BillingAccount.findOne({ where: { stripeCustomerId } });
  return account ? { account, link: null } : null;
}

/**
 * invoice.paid. The first invoice of a Leadzaro subscription is the sale
 * (also covered by checkout.session.completed — the shared invoice id
 * keeps it to one record); later invoices are renewals; invoices for
 * customers Leadzaro doesn't know are ignored.
 */
async function handleInvoicePaid(invoice, { eventCreated, webhookEventId = null } = {}) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  const customerId = idOf(invoice.customer);
  const amount = invoice.amount_paid || 0;
  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date((eventCreated || Date.now() / 1000) * 1000);
  const metadata = invoiceMetadata(invoice);

  const subscription = subscriptionId ? await Subscription.findOne({ where: { stripeSubscriptionId: subscriptionId } }) : null;
  if (subscription) {
    const lineTimes = invoice.lines?.data?.[0]?.period;
    await subscription.update({
      status: 'active',
      currentPeriodStart: invoice.period_start && !lineTimes ? new Date(invoice.period_start * 1000) : lineTimes ? new Date(lineTimes.start * 1000) : subscription.currentPeriodStart,
      currentPeriodEnd: invoice.period_end && !lineTimes ? new Date(invoice.period_end * 1000) : lineTimes ? new Date(lineTimes.end * 1000) : subscription.currentPeriodEnd,
    });
  }

  const request = await findRequest({ metadata });
  if (request && request.status !== 'paid' && amount > 0) {
    // The first real payment of a Leadzaro subscription (possibly after a trial).
    return recordStripePayment({
      request,
      amountCents: amount,
      currency: invoice.currency,
      paidAt,
      ids: { stripeInvoiceId: invoice.id, stripePaymentIntentId: idOf(invoice.payment_intent) },
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      receiptUrl: null,
      invoiceUrl: invoice.hosted_invoice_url || null,
      livemode: invoice.livemode,
      webhookEventId,
    });
  }

  if (amount <= 0) return { ignored: true, reason: 'Nothing was paid on this invoice' };
  const owner = await billingAccountForCustomer(customerId);
  if (!owner && !request) return { ignored: true, reason: 'Invoice for a Stripe customer not linked in Leadzaro' };

  const organizationId = owner?.link?.organizationId || owner?.account?.organizationId || request?.organizationId;
  const organization = organizationId ? await Organization.findByPk(organizationId) : null;
  if (!organization?.managingAgencyOrganizationId) return { ignored: true, reason: 'Invoice for a business outside Leadzaro' };
  try {
    const existing = await SalesPayment.findOne({ where: { stripeInvoiceId: invoice.id } });
    if (existing) {
      if (invoice.hosted_invoice_url && !existing.invoiceUrl) await existing.update({ invoiceUrl: invoice.hosted_invoice_url });
      return { duplicate: true };
    }
    await SalesPayment.create({
      agencyOrganizationId: organization.managingAgencyOrganizationId,
      organizationId: organization.id,
      opportunityId: request?.opportunityId || null,
      paymentLinkRequestId: request?.id || null,
      source: 'stripe',
      kind: invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_update' ? 'renewal' : 'other',
      amountCents: amount,
      currency: invoice.currency,
      paidAt,
      stripeMode: invoice.livemode ? 'live' : stripeMode(),
      stripeCustomerId: customerId,
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: idOf(invoice.payment_intent),
      stripeSubscriptionId: subscriptionId,
      invoiceUrl: invoice.hosted_invoice_url || null,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return { duplicate: true };
  }
  return { recorded: true, kind: 'renewal' };
}

async function handleInvoiceFailed(invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  const subscription = subscriptionId ? await Subscription.findOne({ where: { stripeSubscriptionId: subscriptionId } }) : null;
  if (subscription) await subscription.update({ status: 'past_due' });
  const request = await findRequest({ metadata: invoiceMetadata(invoice) });
  if (request && request.status !== 'paid' && invoice.billing_reason === 'subscription_create') {
    await request.update({ status: 'failed', lastError: 'The first payment failed' });
  }
  if (!subscription && !request) return { ignored: true, reason: 'Invoice for a subscription not managed in Leadzaro' };
  return { updated: true };
}

function subscriptionFacts(sub) {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  const start = sub.current_period_start || item?.current_period_start;
  const end = sub.current_period_end || item?.current_period_end;
  const amount = (sub.items?.data || []).reduce((sum, i) => sum + ((i.price?.unit_amount || 0) * (i.quantity || 1)), 0);
  return {
    status: sub.status,
    currentPeriodStart: start ? new Date(start * 1000) : null,
    currentPeriodEnd: end ? new Date(end * 1000) : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    amountCents: price ? amount : null,
    currency: price?.currency || null,
    interval: price?.recurring?.interval || null,
    productName: typeof price?.product === 'object' ? price.product.name : null,
  };
}

/**
 * customer.subscription.created/updated/deleted. Older events never
 * overwrite a newer state (Stripe does not guarantee order).
 */
async function handleSubscriptionEvent(sub, { eventCreated, deleted = false } = {}) {
  const at = new Date((eventCreated || Math.floor(Date.now() / 1000)) * 1000);
  const facts = subscriptionFacts(sub);
  if (deleted) facts.status = 'canceled';
  const clean = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== null && v !== undefined));

  let subscription = await Subscription.findOne({ where: { stripeSubscriptionId: sub.id } });
  if (subscription) {
    if (subscription.stripeUpdatedAt && subscription.stripeUpdatedAt > at) return { ignored: true, reason: 'Older than the state already recorded' };
    await subscription.update({ ...clean, stripeUpdatedAt: at });
    return { updated: true };
  }

  // Unknown locally: create it only for a business Leadzaro knows.
  const request = await findRequest({ metadata: sub.metadata || {} });
  let owner = await billingAccountForCustomer(idOf(sub.customer));
  if (!owner && request?.organizationId) {
    const [account] = await BillingAccount.findOrCreate({ where: { organizationId: request.organizationId }, defaults: { organizationId: request.organizationId, stripeCustomerId: idOf(sub.customer), status: 'active' } });
    owner = { account };
  }
  if (!owner) return { ignored: true, reason: 'Subscription for a Stripe customer not linked in Leadzaro' };
  try {
    subscription = await Subscription.create({
      billingAccountId: owner.account.id,
      servicePlanId: await servicePlanForRequest(request),
      stripeSubscriptionId: sub.id,
      stripeCustomerId: idOf(sub.customer),
      stripeMode: sub.livemode ? 'live' : stripeMode(),
      ...clean,
      stripeUpdatedAt: at,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  return { created: true };
}

async function handleChargeRefunded(charge) {
  const paymentIntentId = idOf(charge.payment_intent);
  const payment = paymentIntentId ? await SalesPayment.findOne({ where: { stripePaymentIntentId: paymentIntentId } }) : null;
  if (!payment) return { ignored: true, reason: 'Refund for a payment not recorded in Leadzaro' };
  const refunded = charge.amount_refunded || 0;
  await payment.update({ amountRefundedCents: refunded, status: refunded >= payment.amountCents ? 'refunded' : 'partially_refunded', stripeChargeId: charge.id, receiptUrl: payment.receiptUrl || charge.receipt_url || null });
  return { updated: true };
}

const MANUAL_METHODS = ['check', 'cash', 'bank_transfer', 'other'];

/**
 * An authorized payment received outside Stripe. Kept distinct from
 * Stripe-confirmed payments everywhere it is shown or reported.
 */
async function recordManualPayment(ctx, opportunityId, input) {
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null } });
  if (!opportunity) throw invalid('Lead not found', 404);
  const amountCents = Number(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw invalid('Enter the amount received (more than $0).');
  if (amountCents > 100000000) throw invalid('That amount looks too large — check it and try again.');
  const method = MANUAL_METHODS.includes(input.method) ? input.method : null;
  if (!method) throw invalid('Choose how the payment was received.');
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime()) || paidAt > new Date(Date.now() + 86400000)) throw invalid('Enter a valid payment date (not in the future).');
  const reference = input.reference ? String(input.reference).trim().slice(0, 200) : null;
  const note = input.note ? String(input.note).trim().slice(0, 2000) : null;
  assertNoSecrets(reference, 'Reference');
  assertNoSecrets(note, 'Note');
  const currency = String(input.currency || opportunity.currency || 'usd').toLowerCase().slice(0, 3);

  const existingSale = await SalesPayment.findOne({ where: { opportunityId, kind: 'initial' } });
  const payment = await SalesPayment.create({
    agencyOrganizationId: ctx.agencyId,
    organizationId: opportunity.organizationId,
    opportunityId,
    paymentLinkRequestId: null,
    source: 'manual',
    kind: existingSale ? 'other' : 'initial',
    amountCents,
    currency,
    paidAt,
    attributedUserId: opportunity.creditedUserId || opportunity.assignedToUserId || ctx.userId,
    recordedByUserId: ctx.userId,
    method,
    reference,
    note,
  });

  await recordAudit({
    organizationId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: 'sales.manual_payment_recorded',
    targetType: 'Opportunity',
    targetId: opportunityId,
    metadata: {
      paymentId: payment.id, amountCents, currency, method, kind: payment.kind,
    },
    req: ctx.req,
  });

  let result = { converted: false };
  if (payment.kind === 'initial') {
    result = await completeSale({
      opportunityId, agencyOrganizationId: ctx.agencyId, payment, source: 'manual', actorUserId: ctx.userId,
    });
  }
  return { payment, ...result };
}

module.exports = {
  handleCheckoutSession,
  handleCheckoutFailed,
  handleCheckoutExpired,
  handleInvoicePaid,
  handleInvoiceFailed,
  handleSubscriptionEvent,
  handleChargeRefunded,
  recordManualPayment,
  completeSale,
  MANUAL_METHODS,
};

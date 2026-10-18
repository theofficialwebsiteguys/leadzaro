'use strict';

const {
  sequelize, Opportunity, Organization, PaymentLinkRequest, SalesPayment, User,
} = require('../../models');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const { isForward, STAGE_LABELS } = require('../../core/crm/pipelineCatalog');
const { convertOpportunityToClient } = require('../billing/conversionService');
const handoffService = require('./handoffService');
const { membersWith, memberHas } = require('./teamMembers');
const { invalid, assertNoSecrets, formatMoney } = require('./salesCommon');

/**
 * Closing approval (ADR 0016). A confirmed payment no longer makes a client
 * on its own: the salesperson submits the sale, an admin approves it, and
 * approval runs the existing one-time conversion and handoff, assigning
 * the client manager. Payment links, sent links and confirmed payments stay
 * separate facts; none of them is an approval.
 */

const USER_ATTRS = ['id', 'name'];

async function loadOpp(ctx, opportunityId, options = {}) {
  const opportunity = await Opportunity.findOne({ where: { id: opportunityId, agencyOrganizationId: ctx.agencyId, deletedAt: null }, ...options });
  if (!opportunity) throw invalid('Lead not found', 404);
  return opportunity;
}

async function notifyMany(userIds, payload) {
  for (const userId of new Set(userIds.filter(Boolean))) {
    await notify({ userId, ...payload }).catch(() => null);
  }
}

/**
 * Called once when the first payment for a deal is recorded (Stripe-
 * confirmed or an authorized manual payment). Marks the payment confirmed
 * and tells the salesperson to submit the sale. If the sale was already
 * approved (an approved exception), the conversion runs now (idempotent).
 */
async function afterInitialPayment({ opportunityId, payment, request = null, stripeSubscriptionId = null, source, webhookEventId = null, actorUserId = null }) {
  const opportunity = await Opportunity.findByPk(opportunityId);
  if (!opportunity) return { converted: false };
  const updates = { paymentConfirmedAt: opportunity.paymentConfirmedAt || payment.paidAt || new Date() };
  if (isForward(opportunity.stage, 'awaiting_payment') && opportunity.stage !== 'won') {
    updates.stage = 'awaiting_payment';
    updates.stageChangedAt = new Date();
  }
  await opportunity.update(updates);

  if (opportunity.closingStatus === 'approved' || opportunity.stage === 'won') {
    // eslint-disable-next-line global-require
    const { completeSale } = require('./paymentEventsService');
    return completeSale({
      opportunityId, agencyOrganizationId: opportunity.agencyOrganizationId, payment, request, stripeSubscriptionId, source, webhookEventId, actorUserId,
    });
  }

  const organization = await Organization.findByPk(opportunity.organizationId, { attributes: ['name'] });
  const recipient = payment.attributedUserId || opportunity.assignedToUserId;
  if (recipient) {
    await notify({
      userId: recipient,
      organizationId: opportunity.agencyOrganizationId,
      type: 'sales.payment_received',
      title: `Payment confirmed — ${organization?.name || 'your deal'}`,
      body: `${formatMoney(payment.amountCents, payment.currency)} was ${payment.source === 'stripe' ? 'confirmed by Stripe' : 'recorded'}. Submit the sale for closing approval.`,
      data: { opportunityId, link: `/app/work/${opportunityId}` },
    }).catch(() => null);
  }
  return { converted: false, awaitingApproval: true };
}

/** The payment facts approval relies on: initial payment, its request, and any pricing sent. */
async function paymentFacts(opportunity) {
  const payment = await SalesPayment.findOne({ where: { opportunityId: opportunity.id, kind: 'initial' }, order: [['paidAt', 'ASC']] });
  const request = payment?.paymentLinkRequestId
    ? await PaymentLinkRequest.findByPk(payment.paymentLinkRequestId)
    : await PaymentLinkRequest.findOne({ where: { opportunityId: opportunity.id, replacedByRequestId: null }, order: [['createdAt', 'DESC']] });
  return { payment, request };
}

/** The salesperson submits a completed sale for approval. Submitting twice changes nothing. */
async function submit(ctx, opportunityId, { note }) {
  const text = String(note || '').trim().slice(0, 2000);
  assertNoSecrets(text, 'Closing note');
  const opportunity = await loadOpp(ctx, opportunityId);
  if (opportunity.assignedToUserId && opportunity.assignedToUserId !== ctx.userId && !ctx.can('leads.assign')) {
    throw invalid('Only the lead’s salesperson or a manager can submit this sale.', 403);
  }
  if (opportunity.closingStatus === 'submitted') return { closingStatus: 'submitted', alreadySubmitted: true };
  if (opportunity.closingStatus === 'approved' || opportunity.stage === 'won') throw invalid('This sale is already approved.', 409);
  if (opportunity.stage === 'lost' || opportunity.doNotContact) throw invalid('This deal is closed or marked do not contact.', 409);
  if (!opportunity.paymentConfirmedAt && !text) {
    throw invalid('No payment is confirmed yet. Explain the arrangement (for example “Paying by check on Friday”) so an admin can approve an exception, or wait for the payment.', 422, { code: 'no_payment' });
  }
  await opportunity.update({
    closingStatus: 'submitted', closingSubmittedAt: new Date(), closingSubmittedByUserId: ctx.userId, closingNote: text || null, closingReviewNote: null,
  });
  const organization = await Organization.findByPk(opportunity.organizationId, { attributes: ['name'] });
  const approvers = await membersWith(ctx.agencyId, 'sales.approve_close');
  await notifyMany(approvers.map((a) => a.id).filter((id) => id !== ctx.userId), {
    organizationId: ctx.agencyId,
    type: 'sales.closing_submitted',
    title: `Sale submitted for approval — ${organization?.name || 'a deal'}`,
    body: `${ctx.user?.name || 'Sales'} submitted this sale${opportunity.paymentConfirmedAt ? ' (payment confirmed)' : ' without a confirmed payment — exception requested'}.`,
    data: { opportunityId, link: '/app/team-work?tab=approvals' },
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.closing_submitted', targetType: 'Opportunity', targetId: opportunityId, metadata: { paymentConfirmed: Boolean(opportunity.paymentConfirmedAt) }, req: ctx.req,
  });
  return { closingStatus: 'submitted' };
}

/**
 * An admin approves a submitted sale: converts it into exactly one client
 * (the conversion path is idempotent and locked), assigns the client
 * manager and prepares the onboarding checklist from the sale.
 */
async function approve(ctx, opportunityId, { clientManagerUserId = null, exceptionReason = null }) {
  const exception = String(exceptionReason || '').trim().slice(0, 500);
  assertNoSecrets(exception, 'Exception reason');
  if (clientManagerUserId && !(await memberHas(ctx.agencyId, clientManagerUserId, 'clients.onboard'))) {
    throw invalid('Choose a client manager from the team.');
  }
  const managers = await membersWith(ctx.agencyId, 'clients.onboard');
  if (!clientManagerUserId && managers.length) throw invalid('Choose who will onboard this client.');

  let approvedNow = false;
  await sequelize.transaction(async (transaction) => {
    const opportunity = await loadOpp(ctx, opportunityId, { transaction, lock: transaction.LOCK.UPDATE });
    if (opportunity.closingStatus === 'approved') return;
    if (opportunity.closingStatus !== 'submitted') throw invalid('This sale hasn’t been submitted for approval.', 409);
    if (!opportunity.paymentConfirmedAt && !exception) {
      throw invalid('No payment is confirmed. Record the reason for approving an exception (for example an alternate payment arrangement).', 422, { code: 'exception_required' });
    }
    await opportunity.update({
      closingStatus: 'approved',
      closingReviewedAt: new Date(),
      closingReviewedByUserId: ctx.userId,
      closingException: opportunity.paymentConfirmedAt ? null : exception,
      clientManagerUserId: clientManagerUserId || null,
    }, { transaction });
    approvedNow = true;
  });
  if (!approvedNow) return { closingStatus: 'approved', alreadyApproved: true };

  const opportunity = await loadOpp(ctx, opportunityId);
  const { payment, request } = await paymentFacts(opportunity);
  let result;
  if (payment) {
    // eslint-disable-next-line global-require
    const { completeSale } = require('./paymentEventsService');
    result = await completeSale({
      opportunityId,
      agencyOrganizationId: ctx.agencyId,
      payment,
      request: request?.id === payment.paymentLinkRequestId ? request : null,
      stripeSubscriptionId: payment.stripeSubscriptionId || request?.stripeSubscriptionId || null,
      source: 'manual',
      actorUserId: ctx.userId,
      // Approval sends its own notices below.
      notifySeller: false,
    });
  } else {
    // Approved exception: no payment yet. Same conversion path, no billing facts invented.
    try {
      const conversion = await convertOpportunityToClient({
        opportunityId, agencyOrganizationId: ctx.agencyId, creditedUserId: opportunity.assignedToUserId, source: 'manual', actorUserId: ctx.userId,
      });
      await handoffService.runAfterConversion({ opportunityId, conversion, actorUserId: ctx.userId });
      result = { converted: true, alreadyConverted: conversion.alreadyConverted };
    } catch (err) {
      await handoffService.markConversionFailed(opportunity, `Approved, but the client could not be set up: ${err.message}`);
      result = { converted: false, error: err.message };
    }
  }

  const organization = await Organization.findByPk(opportunity.organizationId, { attributes: ['id', 'name'] });
  if (clientManagerUserId) {
    await notify({
      userId: clientManagerUserId,
      organizationId: ctx.agencyId,
      type: 'client_handoff',
      title: `New client to onboard — ${organization?.name}`,
      body: `${ctx.user?.name || 'An admin'} approved this sale and assigned the onboarding to you.`,
      data: { opportunityId, link: `/app/onboarding/${opportunityId}` },
    }).catch(() => null);
  }
  await notifyMany([opportunity.closingSubmittedByUserId, opportunity.assignedToUserId].filter((id) => id !== ctx.userId), {
    organizationId: ctx.agencyId,
    type: 'sales.closing_approved',
    title: `Sale approved — ${organization?.name}`,
    body: 'The business is now a client and has been handed to onboarding.',
    data: { opportunityId, link: `/app/work/${opportunityId}` },
  });
  await recordAudit({
    organizationId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: 'sales.closing_approved',
    targetType: 'Opportunity',
    targetId: opportunityId,
    metadata: { clientManagerUserId, exception: exception || null, converted: result?.converted ?? false },
    req: ctx.req,
  });
  return { closingStatus: 'approved', ...result };
}

/** An admin sends a submitted sale back with a reason. */
async function returnToSales(ctx, opportunityId, { reason }) {
  const text = String(reason || '').trim().slice(0, 500);
  if (!text) throw invalid('Say what needs to change before it can be approved.');
  assertNoSecrets(text, 'Reason');
  const opportunity = await loadOpp(ctx, opportunityId);
  if (opportunity.closingStatus !== 'submitted') throw invalid('Only a submitted sale can be returned.', 409);
  await opportunity.update({
    closingStatus: 'returned', closingReviewedAt: new Date(), closingReviewedByUserId: ctx.userId, closingReviewNote: text,
  });
  const organization = await Organization.findByPk(opportunity.organizationId, { attributes: ['name'] });
  await notifyMany([opportunity.closingSubmittedByUserId, opportunity.assignedToUserId], {
    organizationId: ctx.agencyId,
    type: 'sales.closing_returned',
    title: `Sale returned — ${organization?.name}`,
    body: text,
    data: { opportunityId, link: `/app/work/${opportunityId}` },
  });
  await recordAudit({
    organizationId: ctx.agencyId, actorUserId: ctx.userId, action: 'sales.closing_returned', targetType: 'Opportunity', targetId: opportunityId, metadata: { reason: text }, req: ctx.req,
  });
  return { closingStatus: 'returned' };
}

/** Sales waiting for approval, with what the approver needs to decide. */
async function pending(ctx) {
  const opportunities = await Opportunity.findAll({
    where: { agencyOrganizationId: ctx.agencyId, deletedAt: null, closingStatus: 'submitted' },
    include: [
      { model: Organization, as: 'organization', attributes: ['id', 'name', 'city', 'state', 'type'] },
      { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      { model: User, as: 'closingSubmittedBy', attributes: USER_ATTRS },
      { model: User, as: 'qualifiedBy', attributes: USER_ATTRS },
    ],
    order: [['closingSubmittedAt', 'ASC']],
  });
  const items = [];
  for (const o of opportunities) {
    const { payment, request } = await paymentFacts(o);
    items.push({
      opportunityId: o.id,
      businessName: o.organization?.name,
      city: o.organization?.city,
      state: o.organization?.state,
      isExistingClient: o.organization?.type === 'client',
      stageLabel: STAGE_LABELS[o.stage],
      salesperson: o.assignedTo,
      submittedBy: o.closingSubmittedBy,
      submittedAt: o.closingSubmittedAt,
      note: o.closingNote,
      qualifiedBy: o.qualifiedBy,
      proposal: o.proposal,
      paymentConfirmedAt: o.paymentConfirmedAt,
      payment: payment ? {
        amountCents: payment.amountCents, currency: payment.currency, source: payment.source, method: payment.method, paidAt: payment.paidAt, stripeMode: payment.stripeMode,
      } : null,
      offer: request ? {
        title: request.offerTitle, initialAmountCents: request.initialAmountCents, recurringAmountCents: request.recurringAmountCents, recurringInterval: request.recurringInterval, currency: request.currency, status: request.status,
      } : null,
    });
  }
  return { items, clientManagers: await membersWith(ctx.agencyId, 'clients.onboard') };
}

/** The distinct closing milestones for the lead page — each a separate recorded fact. */
async function milestones(opportunity) {
  const requests = await PaymentLinkRequest.findAll({ where: { opportunityId: opportunity.id }, order: [['createdAt', 'ASC']], attributes: ['createdAt', 'sentAt', 'status'] });
  const firstSent = requests.find((r) => r.sentAt);
  const step = (key, label, at) => ({ key, label, done: Boolean(at), at: at || null });
  return [
    step('pricing_sent', 'Pricing sent', opportunity.proposal?.sentAt || null),
    step('link_prepared', 'Payment link prepared', requests[0]?.createdAt || null),
    step('link_sent', 'Payment link sent', firstSent?.sentAt || null),
    step('payment_confirmed', 'Payment confirmed', opportunity.paymentConfirmedAt),
    step('closing_submitted', 'Submitted for approval', opportunity.closingSubmittedAt),
    step('approved', 'Approved client', opportunity.closingStatus === 'approved' ? opportunity.closingReviewedAt : (opportunity.stage === 'won' ? opportunity.wonAt : null)),
  ];
}

module.exports = {
  afterInitialPayment, submit, approve, returnToSales, pending, milestones,
};

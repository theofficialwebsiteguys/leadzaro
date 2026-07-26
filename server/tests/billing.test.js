'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Organization, ConversionAttempt, BillingAccount, WebhookEvent, ServicePlan, Subscription, Contact, Invitation,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { getStripeAdapter } = require('../core/integrations/stripe/stripeAdapter');
const conversionService = require('../modules/billing/conversionService');
const { SYSTEM_USER_ID } = require('../core/constants/systemUser');

afterAll(async () => {
  await sequelize.close();
});

function uniquePlaceId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function createOpportunity(auth, name, prefix) {
  const res = await auth(request(app).post('/api/v1/crm/opportunities').send({
    leadData: { name, googlePlaceId: uniquePlaceId(prefix) },
  }));
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('Billing: Payment Links', () => {
  test('creates a payment link for a prospect opportunity, listed afterward, rejected once the organization is no longer a prospect', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const opp = await createOpportunity(auth, 'Payment Link Test Biz', 'paylink');
    const servicePlan = await ServicePlan.findOne({ where: { key: 'starter_website' } });

    const create = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/payment-links`).send({
      servicePlanId: servicePlan.id,
    }));
    expect(create.status).toBe(200);
    expect(create.body.data.paymentLinkRequest.stripePaymentLinkUrl).toMatch(/^https:\/\/mock\.stripe\.test/);

    const list = await auth(request(app).get(`/api/v1/crm/opportunities/${opp.opportunity.id}/payment-links`));
    expect(list.status).toBe(200);
    expect(list.body.data.paymentLinkRequests.length).toBe(1);

    // Flip the organization to client directly (simulating a completed conversion).
    await Organization.update({ type: 'client' }, { where: { id: opp.organization.id } });
    const afterConvert = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/payment-links`).send({
      servicePlanId: servicePlan.id,
    }));
    expect(afterConvert.status).toBe(422);
  });

  test('rejects an unknown or inactive service plan', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Bad Plan Test Biz', 'badplan');

    const res = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/payment-links`).send({
      servicePlanId: '00000000-0000-0000-0000-000000000000',
    }));
    expect(res.status).toBe(422);
  });
});

describe('Billing: webhook processing and conversion idempotency', () => {
  test('a checkout.session.completed webhook converts the opportunity to a client exactly once; the identical event delivered twice is a no-op the second time', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Webhook Convert Test Biz', 'webhookconv');

    const adapter = getStripeAdapter();
    const event = adapter.buildCheckoutCompletedEvent({
      opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId,
    });

    const first = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(first.status).toBe(200);

    const organization = await Organization.findByPk(opp.organization.id);
    expect(organization.type).toBe('client');

    const opportunityAfter = await sequelize.models.Opportunity.findByPk(opp.opportunity.id);
    expect(opportunityAfter.stage).toBe('Closed Won');

    const billingAccount = await BillingAccount.findOne({ where: { organizationId: opp.organization.id } });
    expect(billingAccount).not.toBeNull();

    const conversions = await ConversionAttempt.findAll({ where: { opportunityId: opp.opportunity.id } });
    expect(conversions.length).toBe(1);
    expect(conversions[0].status).toBe('completed');

    // Deliver the exact same event again (Stripe's own retry behavior).
    const second = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(second.status).toBe(200);

    const webhookRows = await WebhookEvent.findAll({ where: { stripeEventId: event.id } });
    expect(webhookRows.length).toBe(1);
    const conversionsAfterRetry = await ConversionAttempt.findAll({ where: { opportunityId: opp.opportunity.id } });
    expect(conversionsAfterRetry.length).toBe(1);
  });

  test('two concurrent conversion attempts for the same opportunity (simulating a webhook racing a manual conversion) result in exactly one completed ConversionAttempt', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Race Condition Test Biz', 'racecond');

    const [resultA, resultB] = await Promise.all([
      conversionService.convertOpportunityToClient({
        opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId, source: 'manual',
      }),
      conversionService.convertOpportunityToClient({
        opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId, source: 'manual',
      }),
    ]);

    // Both calls resolve successfully — one did the real work, the other
    // discovered it was already done — neither throws an unhandled
    // unique-constraint error up to the caller.
    expect([resultA.alreadyConverted, resultB.alreadyConverted].filter((v) => v === true).length).toBe(1);
    expect([resultA.alreadyConverted, resultB.alreadyConverted].filter((v) => v === false).length).toBe(1);

    const completed = await ConversionAttempt.findAll({ where: { opportunityId: opp.opportunity.id, status: 'completed' } });
    expect(completed.length).toBe(1);
    const billingAccounts = await BillingAccount.findAll({ where: { organizationId: opp.organization.id } });
    expect(billingAccounts.length).toBe(1);
  });

  test('manual conversion after a webhook already converted the same opportunity is a no-op', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Manual After Webhook Test Biz', 'manualafter');

    const adapter = getStripeAdapter();
    const event = adapter.buildCheckoutCompletedEvent({
      opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId,
    });
    await request(app).post('/api/v1/billing/webhooks/stripe').send(event);

    const manual = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/convert`).send({}));
    expect(manual.status).toBe(200);
    expect(manual.body.data.alreadyConverted).toBe(true);

    const completed = await ConversionAttempt.findAll({ where: { opportunityId: opp.opportunity.id, status: 'completed' } });
    expect(completed.length).toBe(1);
  });

  test('a payment event with no resolvable opportunity metadata is recorded as needs_attention, not silently dropped or errored', async () => {
    const event = {
      id: `mock_evt_unresolvable_${Date.now()}`,
      type: 'checkout.session.completed',
      data: { object: { id: 'mock_cs_orphan', customer: 'mock_cus_orphan', metadata: {} } },
    };

    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200);

    const needsAttention = await ConversionAttempt.findOne({
      where: { status: 'needs_attention', webhookEventId: (await WebhookEvent.findOne({ where: { stripeEventId: event.id } })).id },
    });
    expect(needsAttention).not.toBeNull();
    expect(needsAttention.opportunityId).toBeNull();
    expect(needsAttention.failureReason).toMatch(/metadata/i);
  });

  test('conversion-attempts worklist and payment-link data are scoped to the caller\'s own agency', async () => {
    const agencyA = await createOrganization(sequelize.models, { type: 'agency' });
    const agencyB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyA.id, roleKeys: ['sales_manager'] });
    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: agencyB.id, roleKeys: ['sales_manager'] });

    const loginA = await loginAs(app, userA.email, passwordA);
    const authA = (r) => r.set('Authorization', `Bearer ${loginA.token}`);
    const opp = await createOpportunity(authA, 'Isolated Billing Biz', 'isobill');
    const adapter = getStripeAdapter();
    const event = adapter.buildCheckoutCompletedEvent({
      opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId,
    });
    await request(app).post('/api/v1/billing/webhooks/stripe').send(event);

    const loginB = await loginAs(app, userB.email, passwordB);
    const authB = (r) => r.set('Authorization', `Bearer ${loginB.token}`);
    const listB = await authB(request(app).get('/api/v1/billing/conversion-attempts'));
    expect(listB.status).toBe(200);
    expect(listB.body.data.conversionAttempts.find((c) => c.opportunityId === opp.opportunity.id)).toBeUndefined();

    const crossConvert = await authB(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/convert`).send({}));
    expect(crossConvert.status).toBe(404);
  });
});

/**
 * Sets up an agency + opportunity, creates a real Payment Link for it
 * (so handleCheckoutCompleted can resolve a servicePlanId), then converts
 * via a checkout.session.completed webhook carrying a caller-supplied
 * stripeSubscriptionId, so lifecycle tests have a real Subscription row
 * to target by id.
 */
async function setupConvertedOpportunityWithSubscription(stripeSubscriptionId) {
  const org = await createOrganization(sequelize.models, { type: 'agency' });
  const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
  const login = await loginAs(app, user.email, password);
  const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
  const opp = await createOpportunity(auth, 'Lifecycle Sync Test Biz', 'lifecycle');
  const servicePlan = await ServicePlan.findOne({ where: { key: 'starter_website' } });

  await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/payment-links`).send({ servicePlanId: servicePlan.id }));

  const adapter = getStripeAdapter();
  const checkoutEvent = adapter.buildCheckoutCompletedEvent({
    opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId, stripeSubscriptionId,
  });
  const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(checkoutEvent);
  expect(res.status).toBe(200);

  const subscription = await Subscription.findOne({ where: { stripeSubscriptionId } });
  expect(subscription).not.toBeNull();
  return {
    org, user, password, auth, opp, subscription,
  };
}

describe('Billing: subscription lifecycle sync', () => {
  test('invoice.payment_succeeded activates the subscription and syncs its billing period', async () => {
    const stripeSubscriptionId = `mock_sub_lifecycle_succeeded_${Date.now()}`;
    const { subscription } = await setupConvertedOpportunityWithSubscription(stripeSubscriptionId);

    const periodStart = Math.floor(Date.now() / 1000);
    const periodEnd = periodStart + 30 * 24 * 60 * 60;
    const adapter = getStripeAdapter();
    const event = adapter.buildInvoiceEvent({
      type: 'invoice.payment_succeeded', stripeSubscriptionId, periodStart, periodEnd,
    });
    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200);

    await subscription.reload();
    expect(subscription.status).toBe('active');
    expect(Math.floor(subscription.currentPeriodStart.getTime() / 1000)).toBe(periodStart);
    expect(Math.floor(subscription.currentPeriodEnd.getTime() / 1000)).toBe(periodEnd);
  });

  test('invoice.payment_failed marks the subscription past_due', async () => {
    const stripeSubscriptionId = `mock_sub_lifecycle_failed_${Date.now()}`;
    const { subscription } = await setupConvertedOpportunityWithSubscription(stripeSubscriptionId);

    const adapter = getStripeAdapter();
    const event = adapter.buildInvoiceEvent({ type: 'invoice.payment_failed', stripeSubscriptionId });
    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200);

    await subscription.reload();
    expect(subscription.status).toBe('past_due');
  });

  test('a one-off invoice with no subscription field is a benign no-op, not a failure', async () => {
    const adapter = getStripeAdapter();
    const event = adapter.buildInvoiceEvent({ type: 'invoice.payment_succeeded', stripeSubscriptionId: null });
    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200);

    const webhookRow = await WebhookEvent.findOne({ where: { stripeEventId: event.id } });
    expect(webhookRow.status).toBe('processed');
  });

  test('customer.subscription.updated syncs status and billing period', async () => {
    const stripeSubscriptionId = `mock_sub_lifecycle_updated_${Date.now()}`;
    const { subscription } = await setupConvertedOpportunityWithSubscription(stripeSubscriptionId);

    const periodStart = Math.floor(Date.now() / 1000);
    const periodEnd = periodStart + 30 * 24 * 60 * 60;
    const adapter = getStripeAdapter();
    const event = adapter.buildSubscriptionEvent({
      type: 'customer.subscription.updated', stripeSubscriptionId, status: 'trialing', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd,
    });
    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200);

    await subscription.reload();
    expect(subscription.status).toBe('trialing');
    expect(Math.floor(subscription.currentPeriodStart.getTime() / 1000)).toBe(periodStart);
  });

  test('customer.subscription.deleted cancels the subscription', async () => {
    const stripeSubscriptionId = `mock_sub_lifecycle_deleted_${Date.now()}`;
    const { subscription } = await setupConvertedOpportunityWithSubscription(stripeSubscriptionId);

    const adapter = getStripeAdapter();
    const event = adapter.buildSubscriptionEvent({ type: 'customer.subscription.deleted', stripeSubscriptionId });
    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200);

    await subscription.reload();
    expect(subscription.status).toBe('canceled');
  });

  test('a lifecycle event referencing an unknown stripeSubscriptionId is recorded as a failed webhook event, not silently dropped', async () => {
    const adapter = getStripeAdapter();
    const event = adapter.buildInvoiceEvent({ type: 'invoice.payment_failed', stripeSubscriptionId: `mock_sub_unknown_${Date.now()}` });
    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200); // never surfaced as an HTTP error — see § 7a

    const webhookRow = await WebhookEvent.findOne({ where: { stripeEventId: event.id } });
    expect(webhookRow.status).toBe('failed');
    expect(webhookRow.errorMessage).toMatch(/No local Subscription found/);
  });
});

describe('Billing: failed-webhook-event reprocessing (recovery path)', () => {
  test('a failed lifecycle event can be reprocessed once its underlying cause is fixed, and moves to processed', async () => {
    const stripeSubscriptionId = `mock_sub_reprocess_${Date.now()}`;
    // Deliver the failure first: subscription doesn't exist locally yet.
    const adapter = getStripeAdapter();
    const failingEvent = adapter.buildInvoiceEvent({ type: 'invoice.payment_failed', stripeSubscriptionId });
    await request(app).post('/api/v1/billing/webhooks/stripe').send(failingEvent);
    const webhookRow = await WebhookEvent.findOne({ where: { stripeEventId: failingEvent.id } });
    expect(webhookRow.status).toBe('failed');

    // Fix the underlying cause: the subscription now exists locally.
    await setupConvertedOpportunityWithSubscription(stripeSubscriptionId);

    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const reprocess = await auth(request(app).post(`/api/v1/billing/webhook-events/${webhookRow.id}/reprocess`));
    expect(reprocess.status).toBe(200);

    await webhookRow.reload();
    expect(webhookRow.status).toBe('processed');
    const subscription = await Subscription.findOne({ where: { stripeSubscriptionId } });
    expect(subscription.status).toBe('past_due');
  });

  test('reprocessing a webhook event that is not currently failed is rejected', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['administrator'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Reprocess Guard Test Biz', 'reprocessguard');

    const adapter = getStripeAdapter();
    const event = adapter.buildCheckoutCompletedEvent({
      opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId,
    });
    await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    const webhookRow = await WebhookEvent.findOne({ where: { stripeEventId: event.id } });
    expect(webhookRow.status).toBe('processed');

    const reprocess = await auth(request(app).post(`/api/v1/billing/webhook-events/${webhookRow.id}/reprocess`));
    expect(reprocess.status).toBe(422);
  });

  test('billing.manage_webhooks is required — a sales_manager without it is forbidden from listing or reprocessing webhook events', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);

    const list = await auth(request(app).get('/api/v1/billing/webhook-events'));
    expect(list.status).toBe(403);

    const reprocess = await auth(request(app).post('/api/v1/billing/webhook-events/00000000-0000-0000-0000-000000000000/reprocess'));
    expect(reprocess.status).toBe(403);
  });
});

describe('Billing: automatic client-user invitation on conversion', () => {
  test('converting an opportunity invites the organization\'s primary contact as a client user', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Invite Primary Contact Test Biz', 'invitecontact');

    await Contact.create({
      organizationId: opp.organization.id,
      agencyOrganizationId: opp.opportunity.agencyOrganizationId,
      name: 'Primary Contact',
      email: 'primary-contact@example.test',
      isPrimary: true,
    });

    const adapter = getStripeAdapter();
    const event = adapter.buildCheckoutCompletedEvent({
      opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId,
    });
    const res = await request(app).post('/api/v1/billing/webhooks/stripe').send(event);
    expect(res.status).toBe(200);

    const conversionAttempt = await ConversionAttempt.findOne({ where: { opportunityId: opp.opportunity.id, status: 'completed' } });
    expect(conversionAttempt.clientInvitationStatus).toBe('sent');
    expect(conversionAttempt.invitationId).not.toBeNull();

    const invitation = await Invitation.findByPk(conversionAttempt.invitationId);
    expect(invitation.email).toBe('primary-contact@example.test');
    expect(invitation.membershipType).toBe('client');
    expect(invitation.roleKeys).toEqual(['client_owner']);
    // Webhook-triggered: no human actor exists, so the seeded system user is used.
    expect(invitation.invitedByUserId).toBe(SYSTEM_USER_ID);
  });

  test('manual conversion invites using the real acting user, not the system user', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Manual Convert Invite Test Biz', 'manualinvite');

    await Contact.create({
      organizationId: opp.organization.id,
      agencyOrganizationId: opp.opportunity.agencyOrganizationId,
      name: 'Manual Primary Contact',
      email: 'manual-primary-contact@example.test',
      isPrimary: true,
    });

    const manual = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/convert`).send({}));
    expect(manual.status).toBe(200);

    const conversionAttempt = await ConversionAttempt.findOne({ where: { opportunityId: opp.opportunity.id, status: 'completed' } });
    const invitation = await Invitation.findByPk(conversionAttempt.invitationId);
    expect(invitation.invitedByUserId).toBe(user.id);
  });

  test('a conversion with no qualifying primary contact records skipped_no_contact instead of failing', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'No Contact Test Biz', 'nocontact');

    const manual = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/convert`).send({}));
    expect(manual.status).toBe(200);

    const conversionAttempt = await ConversionAttempt.findOne({ where: { opportunityId: opp.opportunity.id, status: 'completed' } });
    expect(conversionAttempt.clientInvitationStatus).toBe('skipped_no_contact');
    expect(conversionAttempt.invitationId).toBeNull();
  });

  test('multiple primary contacts: the oldest is invited deterministically and the ambiguity is recorded, not hidden', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'Ambiguous Primary Contact Test Biz', 'ambiguous');

    const older = await Contact.create({
      organizationId: opp.organization.id,
      agencyOrganizationId: opp.opportunity.agencyOrganizationId,
      name: 'Older Primary',
      email: 'older-primary@example.test',
      isPrimary: true,
      createdAt: new Date(Date.now() - 60000),
    });
    await Contact.create({
      organizationId: opp.organization.id,
      agencyOrganizationId: opp.opportunity.agencyOrganizationId,
      name: 'Newer Primary',
      email: 'newer-primary@example.test',
      isPrimary: true,
      createdAt: new Date(),
    });

    const manual = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/convert`).send({}));
    expect(manual.status).toBe(200);

    const conversionAttempt = await ConversionAttempt.findOne({ where: { opportunityId: opp.opportunity.id, status: 'completed' } });
    const invitation = await Invitation.findByPk(conversionAttempt.invitationId);
    expect(invitation.email).toBe(older.email);
    expect(conversionAttempt.failureReason).toMatch(/Multiple primary contacts/);
  });

  test('a duplicate no-op conversion (manual after webhook already converted) never sends a second invitation', async () => {
    const org = await createOrganization(sequelize.models, { type: 'agency' });
    const { user, password } = await createRoleAssignedMember(sequelize.models, { organizationId: org.id, roleKeys: ['sales_manager'] });
    const login = await loginAs(app, user.email, password);
    const auth = (r) => r.set('Authorization', `Bearer ${login.token}`);
    const opp = await createOpportunity(auth, 'No Double Invite Test Biz', 'nodoubleinvite');

    await Contact.create({
      organizationId: opp.organization.id,
      agencyOrganizationId: opp.opportunity.agencyOrganizationId,
      name: 'Dup Test Primary',
      email: 'dup-test-primary@example.test',
      isPrimary: true,
    });

    const adapter = getStripeAdapter();
    const event = adapter.buildCheckoutCompletedEvent({
      opportunityId: opp.opportunity.id, agencyOrganizationId: opp.opportunity.agencyOrganizationId,
    });
    await request(app).post('/api/v1/billing/webhooks/stripe').send(event);

    const manual = await auth(request(app).post(`/api/v1/crm/opportunities/${opp.opportunity.id}/convert`).send({}));
    expect(manual.status).toBe(200);
    expect(manual.body.data.alreadyConverted).toBe(true);

    const invitations = await Invitation.findAll({ where: { email: 'dup-test-primary@example.test' } });
    expect(invitations.length).toBe(1);
  });
});

describe('Billing: past-due subscriptions worklist', () => {
  test('is scoped to the caller\'s own agency\'s clients only', async () => {
    const stripeSubscriptionIdA = `mock_sub_worklist_a_${Date.now()}`;
    const { org: orgA, subscription } = await setupConvertedOpportunityWithSubscription(stripeSubscriptionIdA);
    await subscription.update({ status: 'past_due' });

    const { user: userA, password: passwordA } = await createRoleAssignedMember(sequelize.models, { organizationId: orgA.id, roleKeys: ['sales_manager'] });
    const loginA = await loginAs(app, userA.email, passwordA);
    const authA = (r) => r.set('Authorization', `Bearer ${loginA.token}`);
    const listA = await authA(request(app).get('/api/v1/billing/subscriptions?status=past_due'));
    expect(listA.status).toBe(200);
    expect(listA.body.data.subscriptions.some((s) => s.id === subscription.id)).toBe(true);

    const orgB = await createOrganization(sequelize.models, { type: 'agency' });
    const { user: userB, password: passwordB } = await createRoleAssignedMember(sequelize.models, { organizationId: orgB.id, roleKeys: ['sales_manager'] });
    const loginB = await loginAs(app, userB.email, passwordB);
    const authB = (r) => r.set('Authorization', `Bearer ${loginB.token}`);
    const listB = await authB(request(app).get('/api/v1/billing/subscriptions?status=past_due'));
    expect(listB.status).toBe(200);
    expect(listB.body.data.subscriptions.some((s) => s.id === subscription.id)).toBe(false);
  });
});

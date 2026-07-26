'use strict';

const request = require('supertest');
const app = require('../app');
const {
  sequelize, Organization, ConversionAttempt, BillingAccount, WebhookEvent, ServicePlan,
} = require('../models');
const { createOrganization, createRoleAssignedMember, loginAs } = require('./helpers/factory');
const { getStripeAdapter } = require('../core/integrations/stripe/stripeAdapter');
const conversionService = require('../modules/billing/conversionService');

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

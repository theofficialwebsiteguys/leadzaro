'use strict';

const {
  Opportunity, Organization, ServicePlan, PaymentLinkRequest,
} = require('../../models');
const { getStripeAdapter, MockStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function resolvePriceIds(plans, adapter) {
  const priceIds = plans.map((p) => p.stripePriceId).filter(Boolean);
  if (priceIds.length === plans.length) return priceIds;

  if (adapter instanceof MockStripeAdapter) {
    // Demoable without first syncing plans to a real Stripe account.
    return plans.map((p) => p.stripePriceId || `mock_price_${p.key}`);
  }

  throw invalid('One or more selected service plans have not been synced to Stripe yet (missing stripePriceId)', 422);
}

async function createPaymentLink({
  opportunityId, agencyOrganizationId, servicePlanId, addOnServicePlanIds = [], actorUserId,
}) {
  const opportunity = await Opportunity.findOne({
    where: { id: opportunityId, agencyOrganizationId, deletedAt: null },
    include: [{ model: Organization, as: 'organization' }],
  });
  if (!opportunity) throw invalid('Opportunity not found', 404);
  if (opportunity.organization.type !== 'prospect') {
    throw invalid('Cannot create a Payment Link for an opportunity whose organization is not a prospect', 422);
  }

  const servicePlan = await ServicePlan.findOne({ where: { id: servicePlanId, isActive: true } });
  if (!servicePlan) throw invalid('Unknown or inactive service plan', 422);

  const addOnPlans = addOnServicePlanIds.length
    ? await ServicePlan.findAll({ where: { id: addOnServicePlanIds, isActive: true } })
    : [];
  if (addOnPlans.length !== addOnServicePlanIds.length) throw invalid('One or more add-on service plans are invalid', 422);

  const adapter = getStripeAdapter();
  const priceIds = resolvePriceIds([servicePlan, ...addOnPlans], adapter);

  const link = await adapter.createPaymentLink({
    priceIds, opportunityId, agencyOrganizationId,
  });

  return PaymentLinkRequest.create({
    opportunityId,
    agencyOrganizationId,
    servicePlanId,
    addOnServicePlanIds,
    stripePaymentLinkId: link.id,
    stripePaymentLinkUrl: link.url,
    status: 'created',
    createdByUserId: actorUserId,
  });
}

function listServicePlans() {
  return ServicePlan.findAll({ where: { isActive: true }, order: [['sortOrder', 'ASC']] });
}

function listForOpportunity(opportunityId, agencyOrganizationId) {
  return PaymentLinkRequest.findAll({
    where: { opportunityId, agencyOrganizationId },
    include: [{ model: ServicePlan, as: 'servicePlan' }],
    order: [['createdAt', 'DESC']],
  });
}

module.exports = { createPaymentLink, listServicePlans, listForOpportunity };

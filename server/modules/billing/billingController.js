'use strict';

const paymentLinkService = require('./paymentLinkService');
const conversionService = require('./conversionService');
const { ConversionAttempt, BillingAccount, Organization } = require('../../models');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function listServicePlans(req, res, next) {
  try {
    const servicePlans = await paymentLinkService.listServicePlans();
    return success(res, { servicePlans });
  } catch (err) {
    next(err);
  }
}

async function createPaymentLink(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const paymentLinkRequest = await paymentLinkService.createPaymentLink({
      opportunityId: req.params.id,
      agencyOrganizationId: orgId,
      servicePlanId: req.body.servicePlanId,
      addOnServicePlanIds: req.body.addOnServicePlanIds || [],
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'payment_link.created', targetType: 'Opportunity', targetId: req.params.id, metadata: { servicePlanId: req.body.servicePlanId }, req,
    });

    return success(res, { paymentLinkRequest }, 'Payment link created');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listPaymentLinks(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const paymentLinkRequests = await paymentLinkService.listForOpportunity(req.params.id, orgId);
    return success(res, { paymentLinkRequests });
  } catch (err) {
    next(err);
  }
}

async function manualConvert(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const result = await conversionService.convertOpportunityToClient({
      opportunityId: req.params.id,
      agencyOrganizationId: orgId,
      servicePlanId: req.body.servicePlanId || null,
      source: 'manual',
      actorUserId: req.user.id,
    });

    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'opportunity.converted_manual', targetType: 'Opportunity', targetId: req.params.id, metadata: { alreadyConverted: result.alreadyConverted }, req,
    });

    return success(res, result, result.alreadyConverted ? 'This opportunity was already converted' : 'Opportunity converted to client');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function listConversionAttempts(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const where = { agencyOrganizationId: orgId };
    if (req.query.status) where.status = req.query.status;
    const conversionAttempts = await ConversionAttempt.findAll({ where, order: [['createdAt', 'DESC']] });
    return success(res, { conversionAttempts });
  } catch (err) {
    next(err);
  }
}

async function getCustomerPortalLink(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const clientOrganization = await Organization.findOne({
      where: { id: req.params.organizationId, managingAgencyOrganizationId: orgId, type: 'client' },
    });
    if (!clientOrganization) return error(res, 'Client organization not found', 404);

    const billingAccount = await BillingAccount.findOne({ where: { organizationId: clientOrganization.id } });
    if (!billingAccount?.stripeCustomerId) return error(res, 'No billing account is set up for this client yet', 404);

    const adapter = getStripeAdapter();
    const session = await adapter.createCustomerPortalSession({
      stripeCustomerId: billingAccount.stripeCustomerId,
      returnUrl: `${req.headers.origin || ''}/app/pipeline`,
    });
    return success(res, { url: session.url });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  listServicePlans,
  createPaymentLink,
  listPaymentLinks,
  manualConvert,
  listConversionAttempts,
  getCustomerPortalLink,
};

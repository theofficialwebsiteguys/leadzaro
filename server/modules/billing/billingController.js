'use strict';

const paymentLinkService = require('./paymentLinkService');
const conversionService = require('./conversionService');
const webhookService = require('./webhookService');
const { triggerClientInvitationIfNew } = require('./clientInvitationService');
const {
  ConversionAttempt, BillingAccount, Organization, Subscription, WebhookEvent,
} = require('../../models');
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
    await triggerClientInvitationIfNew(result);

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

/**
 * Subscription has no agencyOrganizationId of its own — it only reaches
 * an agency via BillingAccount.organizationId -> Organization.
 * managingAgencyOrganizationId. A naive Subscription.findAll({where:
 * {status}}) would leak every agency's client subscriptions across
 * tenants; this join is the required cross-tenant guard (see
 * docs/leadzaro/current-phase-plan.md § 7e), mirroring the same pattern
 * already proven in getCustomerPortalLink below.
 */
async function listSubscriptions(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const subscriptions = await Subscription.findAll({
      where,
      include: [{
        model: BillingAccount,
        as: 'billingAccount',
        required: true,
        include: [{
          model: Organization,
          as: 'organization',
          required: true,
          where: { managingAgencyOrganizationId: orgId, type: 'client' },
        }],
      }],
      order: [['updatedAt', 'DESC']],
    });
    return success(res, { subscriptions });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform-admin capability, not agency-scoped: WebhookEvents has no
 * agencyOrganizationId and never has, since Stripe is integrated as one
 * platform-level account, not per-agency Connect (see current-phase-
 * plan.md § 7a). Gated by billing.manage_webhooks rather than filtered
 * by tenant, matching the actual data model instead of inventing scoping
 * a table was never designed to have.
 */
async function listWebhookEvents(req, res, next) {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const webhookEvents = await WebhookEvent.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 200,
    });
    return success(res, { webhookEvents });
  } catch (err) {
    next(err);
  }
}

async function reprocessWebhookEvent(req, res, next) {
  try {
    const result = await webhookService.processWebhookEventById(req.params.id);
    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'webhook_event.reprocessed',
      targetType: 'WebhookEvent',
      targetId: req.params.id,
      metadata: { status: result.status },
      req,
    });
    return success(res, result, `Webhook event reprocessed: ${result.status}`);
  } catch (err) {
    handleServiceError(err, res, next);
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
  listSubscriptions,
  listWebhookEvents,
  reprocessWebhookEvent,
  getCustomerPortalLink,
};

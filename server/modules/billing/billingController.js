'use strict';

const paymentLinkService = require('./paymentLinkService');
const paymentRequestService = require('../sales/paymentRequestService');
const { context: salesContext } = require('../sales/salesCommon');
const conversionService = require('./conversionService');
const webhookService = require('./webhookService');
const { triggerClientInvitationIfNew } = require('./clientInvitationService');
const { ensureProjectForConversion } = require('../projects/projectService');
const {
  ConversionAttempt, BillingAccount, Organization, Subscription, WebhookEvent, ServicePlan,
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

/**
 * Records a ServicePlan's real Stripe product/price ids (roadmap:
 * "Stripe products/prices mapping"). Manual, not an auto-sync against
 * the Stripe API — this phase has no real Stripe credentials in this
 * environment to sync against (see .env.example / docs/leadzaro/
 * stripe-setup.md). Once populated, paymentLinkService.resolvePriceIds
 * uses these directly instead of the mock-only placeholder fallback.
 *
 * Deliberately not scoped by req.context.organization: ServicePlan has
 * no agencyOrganizationId at all — it's a genuinely platform-global
 * catalog, exactly like WebhookEvents, because Stripe is integrated as
 * one platform-level account rather than per-agency Connect (see
 * docs/leadzaro/current-phase-plan.md § 7a). Any administrator/billing-
 * role user in any agency can update this mapping; that's intentional
 * under the current single-real-tenant product scope (master
 * architecture § 3: "multi-agency SaaS launch" is out of initial
 * scope), not an oversight.
 */
async function updateServicePlanStripeMapping(req, res, next) {
  try {
    const servicePlan = await ServicePlan.findByPk(req.params.id);
    if (!servicePlan) return error(res, 'Service plan not found', 404);

    const { stripeProductId, stripePriceId } = req.body;
    await servicePlan.update({
      stripeProductId: stripeProductId ?? servicePlan.stripeProductId,
      stripePriceId: stripePriceId ?? servicePlan.stripePriceId,
    });

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'service_plan.stripe_mapping_updated',
      targetType: 'ServicePlan',
      targetId: servicePlan.id,
      metadata: { stripeProductId: servicePlan.stripeProductId, stripePriceId: servicePlan.stripePriceId },
      req,
    });

    return success(res, { servicePlan }, 'Stripe mapping updated');
  } catch (err) {
    next(err);
  }
}

async function createPaymentLink(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    // Pre-ADR-0011 endpoint: a service plan is resolved to its Stripe price
    // and goes through the same payment request path as the lead workspace.
    const paymentLinkRequest = await paymentRequestService.createFromServicePlan(salesContext(req), req.params.id, {
      servicePlanId: req.body.servicePlanId,
      addOnServicePlanIds: req.body.addOnServicePlanIds || [],
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
    const paymentLinkRequests = await paymentRequestService.listForOpportunity(salesContext(req), req.params.id);
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
      addOnServicePlanIds: req.body.addOnServicePlanIds || [],
      source: 'manual',
      actorUserId: req.user.id,
    });
    await triggerClientInvitationIfNew(result);

    // Best-effort: the conversion itself already succeeded and is real.
    // A rep who just closed a deal should never see "conversion failed"
    // because of a Phase 4 bookkeeping problem creating its Project —
    // recorded here as a durable, queryable audit entry (not just a log
    // line) so it's actually discoverable by an administrator, mirroring
    // how the webhook path's equivalent failure surfaces via
    // needs_attention. ConversionAttempt.projectSetupPending also stays
    // true on this path (ensureProjectForConversion only clears it after
    // success), so listConversionAttempts's projectSetupPending filter
    // below finds it too.
    try {
      await ensureProjectForConversion(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[billing] failed to create Project for converted opportunity ${req.params.id}:`, err.message);
      await recordAudit({
        organizationId: orgId,
        actorUserId: req.user.id,
        action: 'project.setup_failed',
        targetType: 'Opportunity',
        targetId: req.params.id,
        metadata: { conversionAttemptId: result.conversionAttempt.id, error: err.message },
        req,
      });
    }

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
    // Surfaces the manual-conversion path's Project-setup failures (see
    // manualConvert above) as a queryable worklist, not just an audit
    // log line an administrator would have to already know to look for.
    if (req.query.projectSetupPending !== undefined) where.projectSetupPending = req.query.projectSetupPending === 'true';
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
      returnUrl: `${req.headers.origin || ''}/app/clients/${clientOrganization.id}/billing`,
    });
    return success(res, { url: session.url });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  listServicePlans,
  updateServicePlanStripeMapping,
  createPaymentLink,
  listPaymentLinks,
  manualConvert,
  listConversionAttempts,
  listSubscriptions,
  listWebhookEvents,
  reprocessWebhookEvent,
  getCustomerPortalLink,
};

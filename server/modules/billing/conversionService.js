'use strict';

const {
  sequelize, Opportunity, Organization, ConversionAttempt, BillingAccount, Subscription, ClientProfile,
} = require('../../models');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err) {
  return err.name === 'SequelizeUniqueConstraintError' || err.parent?.code === POSTGRES_UNIQUE_VIOLATION;
}

/**
 * The single idempotent code path for converting a prospect Opportunity
 * into a real client — used by both the webhook handler and manual
 * conversion (checks, cash, imported clients, webhook recovery). Two
 * layers of protection against the same opportunity being converted
 * twice (see docs/leadzaro/current-phase-plan.md § 2b, corrected by
 * independent review — a plain SELECT-then-act business check alone is
 * a TOCTOU race):
 *
 * 1. `SELECT ... FOR UPDATE` on the Opportunity row serializes
 *    concurrent calls for the same opportunityId so they don't
 *    interleave.
 * 2. A partial unique index on ConversionAttempts(opportunityId) WHERE
 *    status='completed' is a database-level backstop that holds even if
 *    the lock is ever bypassed or a future code path forgets it — a
 *    caught unique-violation here always means "someone else's
 *    transaction already completed this," never a real error.
 */
async function convertOpportunityToClient({
  opportunityId,
  agencyOrganizationId,
  servicePlanId,
  addOnServicePlanIds = [],
  stripeCustomerId,
  stripeSubscriptionId,
  subscriptionDetails = {},
  creditedUserId,
  source,
  webhookEventId,
  actorUserId,
}) {
  try {
    return await sequelize.transaction(async (transaction) => {
      const opportunity = await Opportunity.findOne({
        where: { id: opportunityId, agencyOrganizationId, deletedAt: null },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!opportunity) throw invalid('Opportunity not found', 404);

      const existing = await ConversionAttempt.findOne({
        where: { opportunityId, status: 'completed' },
        transaction,
      });
      if (existing) return { conversionAttempt: existing, alreadyConverted: true };

      const organization = await Organization.findByPk(opportunity.organizationId, { transaction });
      // A second opportunity for a business that is already a client (an
      // upsell or a new project) links to that same client instead of
      // creating another one (ADR 0011).
      if (organization.type !== 'prospect' && organization.type !== 'client') {
        throw invalid('This opportunity\'s organization is not a prospect or client', 422);
      }

      // Selling to a current client is an upsell, not a new client (ADR 0013);
      // winning back a former client counts as new again.
      // ClientProfile is visibility-guarded; the agency is fixed by the opportunity above.
      const profile = await ClientProfile.findOne({
        where: { organizationId: organization.id, agencyOrganizationId }, transaction, __visibilityScoped: true,
      });
      const createdNewClient = organization.type !== 'client' || Boolean(profile?.clientEndedAt);
      if (organization.type === 'prospect') await organization.update({ type: 'client' }, { transaction });
      const today = new Date().toISOString().slice(0, 10);
      if (!profile) {
        await ClientProfile.create({
          organizationId: organization.id, agencyOrganizationId, acquisitionSource: 'sales', clientSince: today,
        }, { transaction });
      } else if (createdNewClient) {
        await profile.update({
          acquisitionSource: profile.acquisitionSource || 'sales', clientSince: profile.clientSince || today, clientEndedAt: null, endReason: null,
        }, { transaction });
      }
      await opportunity.update({
        stage: 'won',
        stageChangedAt: new Date(),
        wonAt: opportunity.wonAt || new Date(),
        creditedUserId: opportunity.creditedUserId || creditedUserId || opportunity.assignedToUserId || actorUserId || null,
        nextActionAt: null,
        nextActionType: null,
        nextActionNote: null,
      }, { transaction });

      let billingAccount = await BillingAccount.findOne({ where: { organizationId: organization.id }, transaction });
      if (!billingAccount) {
        billingAccount = await BillingAccount.create({
          organizationId: organization.id,
          stripeCustomerId: stripeCustomerId || null,
          status: 'active',
        }, { transaction });
      } else if (stripeCustomerId && !billingAccount.stripeCustomerId) {
        await billingAccount.update({ stripeCustomerId }, { transaction });
      }

      let subscription = null;
      if (stripeSubscriptionId) {
        // The subscription webhook may already have created this row.
        subscription = await Subscription.findOne({ where: { stripeSubscriptionId }, transaction });
        if (subscription) {
          await subscription.update({ billingAccountId: billingAccount.id, servicePlanId: subscription.servicePlanId || servicePlanId || null }, { transaction });
        } else {
          subscription = await Subscription.create({
            billingAccountId: billingAccount.id,
            servicePlanId: servicePlanId || null,
            addOnServicePlanIds,
            stripeSubscriptionId,
            status: 'active',
            stripeCustomerId: stripeCustomerId || null,
            ...subscriptionDetails,
          }, { transaction });
        }
      } else if (servicePlanId) {
        subscription = await Subscription.create({
          billingAccountId: billingAccount.id,
          servicePlanId,
          // Add-ons stay on this one Subscription row rather than
          // becoming separate rows: a real Stripe subscription has one
          // id covering all its line items (base plan + add-ons), and
          // stripeSubscriptionId is unique here — one row per Stripe
          // subscription is the correct mapping, not one row per plan.
          addOnServicePlanIds,
          stripeSubscriptionId: stripeSubscriptionId || null,
          status: 'active',
        }, { transaction });
      }

      const conversionAttempt = await ConversionAttempt.create({
        opportunityId,
        agencyOrganizationId,
        source,
        webhookEventId: webhookEventId || null,
        status: 'completed',
        resultingClientOrganizationId: organization.id,
        projectSetupPending: true,
        createdByUserId: actorUserId || null,
        createdNewClient,
      }, { transaction });

      return {
        conversionAttempt, billingAccount, subscription, alreadyConverted: false,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await ConversionAttempt.findOne({ where: { opportunityId, status: 'completed' } });
      if (existing) return { conversionAttempt: existing, alreadyConverted: true };
    }
    throw err;
  }
}

/**
 * Records a conversion that could not be completed cleanly — either
 * because a payment event's metadata couldn't be resolved to an
 * Opportunity at all (opportunityId/agencyOrganizationId are null in
 * that case — see current-phase-plan.md § 2e) or some other failure
 * partway through. Never throws; "needs attention" is the deliberate
 * safety-valve outcome, not an error path.
 */
async function recordNeedsAttention({
  opportunityId, agencyOrganizationId, source, webhookEventId, failureReason,
}) {
  return ConversionAttempt.create({
    opportunityId: opportunityId || null,
    agencyOrganizationId: agencyOrganizationId || null,
    source,
    webhookEventId: webhookEventId || null,
    status: 'needs_attention',
    failureReason,
  });
}

module.exports = { convertOpportunityToClient, recordNeedsAttention };

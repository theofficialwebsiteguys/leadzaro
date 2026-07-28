'use strict';

const {
  Organization, ServicePlan, BillingAccount, Subscription, SeoEntitlementGrant,
} = require('../../models');
const {
  listSeoEntitlementGrantsForRequester, getSeoEntitlementGrantByIdForRequester, hasActiveSeoEntitlementGrantSystemLevel,
} = require('../../core/authorization/clientVisibleModels');
const { recordAudit } = require('../../core/audit/auditService');

const SEO_ADDON_PLAN_KEY = 'seo_addon';

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.statusCode = 403;
  return err;
}

/**
 * Real, billing-driven entitlement (current-phase-plan.md § 2a) —
 * Subscription has no organizationId of its own, only billingAccountId
 * (BillingAccount hasMany Subscription), so this checks every active
 * Subscription under the organization's BillingAccount, not a single
 * row. Neither Subscription nor BillingAccount is a guarded model (no
 * client-membership request ever reaches this function directly — it's
 * always called from behind an already-resolved, already-scoped
 * Website), so a direct query here is not a raw-unscoped-query
 * violation the way it would be for a guarded model.
 */
async function hasActiveSubscriptionSeoAddon(organizationId) {
  const seoAddonPlan = await ServicePlan.findOne({ where: { key: SEO_ADDON_PLAN_KEY } });
  if (!seoAddonPlan) return false;

  const billingAccount = await BillingAccount.findOne({ where: { organizationId } });
  if (!billingAccount) return false;

  const activeSubscriptions = await Subscription.findAll({
    where: { billingAccountId: billingAccount.id, status: 'active' },
  });
  return activeSubscriptions.some((sub) => (sub.addOnServicePlanIds || []).includes(seoAddonPlan.id));
}

async function hasSeoEntitlement(organizationId) {
  const [subscriptionActive, grantActive] = await Promise.all([
    hasActiveSubscriptionSeoAddon(organizationId),
    hasActiveSeoEntitlementGrantSystemLevel(organizationId),
  ]);
  return subscriptionActive || grantActive;
}

/**
 * The major gate's own mechanism (current-phase-plan.md § 2a) — a
 * service-layer assertion, not route middleware (review finding:
 * resolveContext() never loads the target resource's owning
 * organization, and for an employee actor req.context.organization is
 * the agency, not the specific client org a website belongs to, so
 * this can only be resolved after the website itself is). Called from
 * inside every SEO service function immediately after the website has
 * already been resolved via the existing tenant-scoped accessor.
 */
async function assertSeoEntitlement(context, website) {
  const entitled = await hasSeoEntitlement(website.organizationId);
  if (!entitled) {
    throw forbidden('This website\'s organization does not have an active SEO entitlement');
  }
}

/**
 * Every entitlement action below takes an :organizationId route param
 * that is NOT itself scoped by anything ADR 0007's guard would catch
 * (Organization is unguarded, and requirePermission only checks the
 * actor's role, never that this specific client belongs to the
 * actor's own agency). Without this check, an employee at Agency A
 * could grant/revoke/inspect SEO entitlement for a client actually
 * managed by Agency B — verified explicitly here rather than assumed.
 */
async function assertClientOrganizationOwnedByAgency(context, organizationId) {
  const organization = await Organization.findByPk(organizationId);
  if (!organization || organization.managingAgencyOrganizationId !== context.organization.id) {
    throw invalid('Organization not found', 404);
  }
  return organization;
}

async function listGrants(context, organizationId) {
  await assertClientOrganizationOwnedByAgency(context, organizationId);
  return listSeoEntitlementGrantsForRequester(context, { organizationId });
}

/**
 * Both grant and revoke call recordAudit explicitly (current-phase-
 * plan.md § 2a review correction) — "audit" in the roadmap's "reason/
 * expiration/audit" means the existing immutable audit-event
 * mechanism, not just the grant row's own mutable fields.
 */
async function grantEntitlement({
  context, organizationId, reason, expiresAt, actorUserId,
}) {
  if (!reason?.trim()) throw invalid('reason is required');
  await assertClientOrganizationOwnedByAgency(context, organizationId);

  const grant = await SeoEntitlementGrant.create({
    organizationId,
    agencyOrganizationId: context.organization.id,
    grantedByUserId: actorUserId,
    reason,
    expiresAt: expiresAt || null,
  });

  await recordAudit({
    organizationId: context.organization.id,
    actorUserId,
    action: 'seo.entitlement_granted',
    targetType: 'SeoEntitlementGrant',
    targetId: grant.id,
    metadata: {
      organizationId, reason, expiresAt: expiresAt || null,
    },
  });

  return grant;
}

async function revokeEntitlement({
  context, organizationId, grantId, actorUserId,
}) {
  // No separate ownership check needed here (unlike grant/status) —
  // getSeoEntitlementGrantByIdForRequester is already agency-tenant-
  // scoped, so a grant belonging to another agency's client simply
  // isn't found, exactly the same safety the explicit check provides
  // elsewhere.
  const grant = await getSeoEntitlementGrantByIdForRequester(context, grantId);
  if (!grant || grant.organizationId !== organizationId) throw invalid('Grant not found', 404);
  if (grant.revokedAt) throw invalid('Grant is already revoked', 409);

  await grant.update({ revokedAt: new Date(), revokedByUserId: actorUserId });

  await recordAudit({
    organizationId: grant.agencyOrganizationId,
    actorUserId,
    action: 'seo.entitlement_revoked',
    targetType: 'SeoEntitlementGrant',
    targetId: grant.id,
    metadata: { organizationId },
  });

  return grant;
}

async function getEntitlementStatus(context, organizationId) {
  await assertClientOrganizationOwnedByAgency(context, organizationId);
  return hasSeoEntitlement(organizationId);
}

module.exports = {
  hasSeoEntitlement, assertSeoEntitlement, listGrants, grantEntitlement, revokeEntitlement, getEntitlementStatus, SEO_ADDON_PLAN_KEY,
};

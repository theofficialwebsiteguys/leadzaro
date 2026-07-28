'use strict';

const seoEntitlementService = require('./seoEntitlementService');
const { success, error } = require('../../utils/response');

function handleServiceError(err, res, next) {
  if (err.statusCode) return error(res, err.message, err.statusCode);
  next(err);
}

async function list(req, res, next) {
  try {
    const grants = await seoEntitlementService.listGrants(req.context, req.params.organizationId);
    return success(res, { grants });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function grant(req, res, next) {
  try {
    const result = await seoEntitlementService.grantEntitlement({
      context: req.context,
      organizationId: req.params.organizationId,
      reason: req.body.reason,
      expiresAt: req.body.expiresAt,
      actorUserId: req.user.id,
    });
    return success(res, { grant: result }, 'SEO entitlement granted');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function revoke(req, res, next) {
  try {
    const result = await seoEntitlementService.revokeEntitlement({
      context: req.context,
      organizationId: req.params.organizationId,
      grantId: req.params.grantId,
      actorUserId: req.user.id,
    });
    return success(res, { grant: result }, 'SEO entitlement revoked');
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

async function status(req, res, next) {
  try {
    const entitled = await seoEntitlementService.getEntitlementStatus(req.context, req.params.organizationId);
    return success(res, { entitled });
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

module.exports = {
  list, grant, revoke, status,
};

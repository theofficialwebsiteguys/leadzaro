const membershipService = require('./membershipService');
const { recordAudit } = require('../../core/audit/auditService');
const { notify } = require('../../core/notifications/notificationService');
const { success, error } = require('../../utils/response');

async function list(req, res, next) {
  try {
    const memberships = await membershipService.listForOrganization(req.context.organization.id);
    return success(res, { memberships });
  } catch (err) {
    next(err);
  }
}

async function updateRoles(req, res, next) {
  try {
    const { roleKeys } = req.body;
    const orgId = req.context.organization.id;
    const membership = await membershipService.getMembershipInOrganization(req.params.id, orgId);
    const assigned = await membershipService.replaceRoles(req.params.id, orgId, roleKeys, req.user.id);

    await recordAudit({
      organizationId: orgId,
      actorUserId: req.user.id,
      action: 'membership.roles_updated',
      targetType: 'OrganizationMembership',
      targetId: req.params.id,
      metadata: { roleKeys: assigned },
      req,
    });
    await notify({
      userId: membership.userId,
      organizationId: orgId,
      type: 'role_change',
      title: 'Your roles were updated',
      body: `Your roles are now: ${assigned.join(', ')}`,
    });

    return success(res, { roleKeys: assigned }, 'Roles updated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { status } = req.body;
    const orgId = req.context.organization.id;
    const membership = await membershipService.setStatus(req.params.id, orgId, status);

    await recordAudit({
      organizationId: orgId,
      actorUserId: req.user.id,
      action: 'membership.status_changed',
      targetType: 'OrganizationMembership',
      targetId: req.params.id,
      metadata: { status },
      req,
    });

    return success(res, { membership }, 'Membership status updated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function setPermissionOverride(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const override = await membershipService.setPermissionOverride(req.params.id, orgId, req.body, req.user.id);

    await recordAudit({
      organizationId: orgId,
      actorUserId: req.user.id,
      action: 'membership.permission_override_set',
      targetType: 'OrganizationMembership',
      targetId: req.params.id,
      metadata: { permissionKey: req.body.permissionKey, effect: req.body.effect, reason: req.body.reason },
      req,
    });

    return success(res, { override }, 'Permission override saved');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function removePermissionOverride(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    await membershipService.removePermissionOverride(req.params.id, orgId, req.params.permissionKey);

    await recordAudit({
      organizationId: orgId,
      actorUserId: req.user.id,
      action: 'membership.permission_override_removed',
      targetType: 'OrganizationMembership',
      targetId: req.params.id,
      metadata: { permissionKey: req.params.permissionKey },
      req,
    });

    return success(res, {}, 'Permission override removed');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = {
  list, updateRoles, updateStatus, setPermissionOverride, removePermissionOverride,
};

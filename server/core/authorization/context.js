'use strict';

const { Op } = require('sequelize');
const {
  Organization, OrganizationMembership, Role, Permission, MembershipPermissionOverride,
} = require('../../models');
const { forbidden } = require('../../utils/response');

/**
 * Loads every active membership for a user, each with its combined
 * effective permission set (role permissions ∪ explicit grants −
 * explicit restrictions, restriction always wins).
 */
async function loadActiveMemberships(userId) {
  const memberships = await OrganizationMembership.findAll({
    where: { userId, status: 'active', deletedAt: null },
    include: [
      { model: Organization, as: 'organization' },
      { model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] },
      { model: MembershipPermissionOverride, as: 'permissionOverrides', include: [{ model: Permission, as: 'permission' }] },
    ],
    order: [['createdAt', 'ASC']],
  });

  return memberships
    .filter((m) => m.organization && m.organization.status === 'active')
    .map((membership) => {
      const granted = new Set();
      for (const role of membership.roles || []) {
        for (const perm of role.permissions || []) granted.add(perm.key);
      }
      for (const override of membership.permissionOverrides || []) {
        if (override.effect === 'grant') granted.add(override.permission.key);
      }
      for (const override of membership.permissionOverrides || []) {
        if (override.effect === 'restrict') granted.delete(override.permission.key);
      }
      return { membership, permissionKeys: granted };
    });
}

/**
 * Resolves the authenticated request's active organization context.
 * Must run after `authenticate`. Never trusts an organization id supplied
 * by the client without verifying an active membership exists for it —
 * the `X-Organization-Id` header only selects among the user's *own*
 * active memberships, it cannot grant access to an arbitrary organization.
 */
function resolveContext() {
  return async (req, res, next) => {
    try {
      const memberships = await loadActiveMemberships(req.user.id);
      if (memberships.length === 0) {
        return forbidden(res, 'No active organization membership');
      }

      const requestedOrgId = req.headers['x-organization-id'];
      let selected = requestedOrgId
        ? memberships.find((m) => m.membership.organizationId === requestedOrgId)
        : null;

      if (requestedOrgId && !selected) {
        return forbidden(res, 'You do not have access to that organization');
      }

      if (!selected) {
        selected = memberships[0];
      }

      req.context = {
        user: req.user,
        organization: selected.membership.organization,
        membership: selected.membership,
        permissionKeys: selected.permissionKeys,
        availableMemberships: memberships.map((m) => ({
          organizationId: m.membership.organizationId,
          organizationName: m.membership.organization.name,
          membershipType: m.membership.membershipType,
        })),
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.context?.permissionKeys?.has(permissionKey)) {
      return forbidden(res, `Missing required permission: ${permissionKey}`);
    }
    next();
  };
}

function requireAnyPermission(permissionKeys) {
  return (req, res, next) => {
    const has = permissionKeys.some((key) => req.context?.permissionKeys?.has(key));
    if (!has) {
      return forbidden(res, `Missing one of required permissions: ${permissionKeys.join(', ')}`);
    }
    next();
  };
}

/**
 * For agency-internal surfaces a client membership must never reach even
 * when it holds the same permission key (e.g. client roles hold
 * projects.view for their own project, but the client hub carries our
 * internal costs and access notes). Permission checks still apply on top.
 */
function requireEmployeeMembership() {
  return (req, res, next) => {
    if (req.context?.membership?.membershipType !== 'employee') {
      return forbidden(res, 'This area is only available to agency team members');
    }
    next();
  };
}

module.exports = {
  loadActiveMemberships,
  resolveContext,
  requirePermission,
  requireAnyPermission,
  requireEmployeeMembership,
};

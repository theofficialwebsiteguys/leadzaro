'use strict';

const {
  OrganizationMembership, Role, Permission, MembershipPermissionOverride, User,
} = require('../../models');

/**
 * Active agency employees and their effective permissions (role grants ∪
 * explicit grants − explicit restrictions), computed the same way as the
 * request context in core/authorization/context.js. Used to decide who can
 * receive work: a sales assignee, a client manager, an approver (ADR 0016).
 */
async function activeMembers(agencyId) {
  const memberships = await OrganizationMembership.findAll({
    where: {
      organizationId: agencyId, membershipType: 'employee', status: 'active', deletedAt: null,
    },
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
      { model: Role, as: 'roles', include: [{ model: Permission, as: 'permissions' }] },
      { model: MembershipPermissionOverride, as: 'permissionOverrides', include: [{ model: Permission, as: 'permission' }] },
    ],
  });
  return memberships.filter((m) => m.user).map((m) => {
    const keys = new Set();
    for (const role of m.roles || []) for (const p of role.permissions || []) keys.add(p.key);
    for (const o of m.permissionOverrides || []) if (o.effect === 'grant') keys.add(o.permission.key);
    for (const o of m.permissionOverrides || []) if (o.effect === 'restrict') keys.delete(o.permission.key);
    return {
      id: m.user.id, name: m.user.name, email: m.user.email, roles: (m.roles || []).map((r) => r.name), permissionKeys: keys,
    };
  });
}

/** Members holding `permissionKey`, as { id, name, roles }, sorted by name. */
async function membersWith(agencyId, permissionKey) {
  const members = await activeMembers(agencyId);
  return members
    .filter((m) => m.permissionKeys.has(permissionKey))
    .map((m) => ({ id: m.id, name: m.name, roles: m.roles }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function memberHas(agencyId, userId, permissionKey) {
  if (!userId) return false;
  return (await membersWith(agencyId, permissionKey)).some((m) => m.id === userId);
}

module.exports = { activeMembers, membersWith, memberHas };

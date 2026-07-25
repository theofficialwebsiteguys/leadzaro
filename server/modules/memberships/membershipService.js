'use strict';

const {
  OrganizationMembership, User, Role, MembershipRole, Permission, MembershipPermissionOverride,
} = require('../../models');

function listForOrganization(organizationId) {
  return OrganizationMembership.findAll({
    where: { organizationId, deletedAt: null },
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'email', 'isActive'] },
      { model: Role, as: 'roles', attributes: ['id', 'key', 'name'] },
    ],
    order: [['createdAt', 'ASC']],
  });
}

async function getMembershipInOrganization(membershipId, organizationId) {
  const membership = await OrganizationMembership.findOne({
    where: { id: membershipId, organizationId, deletedAt: null },
  });
  if (!membership) {
    const err = new Error('Membership not found in this organization');
    err.statusCode = 404;
    throw err;
  }
  return membership;
}

async function replaceRoles(membershipId, organizationId, roleKeys, assignedByUserId) {
  const membership = await getMembershipInOrganization(membershipId, organizationId);

  const roles = await Role.findAll({ where: { key: roleKeys } });
  if (roles.length !== roleKeys.length) {
    const err = new Error('One or more role keys are invalid');
    err.statusCode = 422;
    throw err;
  }
  const mismatched = roles.find((r) => r.scope !== membership.membershipType);
  if (mismatched) {
    const err = new Error(`Role "${mismatched.key}" cannot be assigned to a ${membership.membershipType} membership`);
    err.statusCode = 422;
    throw err;
  }

  await MembershipRole.destroy({ where: { membershipId } });
  await MembershipRole.bulkCreate(roles.map((role) => ({
    membershipId, roleId: role.id, assignedByUserId,
  })));

  return roles.map((r) => r.key);
}

async function setStatus(membershipId, organizationId, status) {
  const membership = await getMembershipInOrganization(membershipId, organizationId);
  const updates = { status };
  if (status === 'removed') {
    updates.deletedAt = new Date();
  }
  if (status === 'suspended' || status === 'active') {
    updates.archivedAt = null;
  }
  await membership.update(updates);
  return membership;
}

async function setPermissionOverride(membershipId, organizationId, { permissionKey, effect, reason }, createdByUserId) {
  await getMembershipInOrganization(membershipId, organizationId);

  const permission = await Permission.findOne({ where: { key: permissionKey } });
  if (!permission) {
    const err = new Error('Unknown permission key');
    err.statusCode = 422;
    throw err;
  }

  const [override, createdNew] = await MembershipPermissionOverride.findOrCreate({
    where: { membershipId, permissionId: permission.id },
    defaults: { effect, reason, createdByUserId },
  });
  if (!createdNew) {
    await override.update({ effect, reason, createdByUserId });
  }
  return override;
}

async function removePermissionOverride(membershipId, organizationId, permissionKey) {
  await getMembershipInOrganization(membershipId, organizationId);
  const permission = await Permission.findOne({ where: { key: permissionKey } });
  if (!permission) return;
  await MembershipPermissionOverride.destroy({ where: { membershipId, permissionId: permission.id } });
}

module.exports = {
  listForOrganization,
  getMembershipInOrganization,
  replaceRoles,
  setStatus,
  setPermissionOverride,
  removePermissionOverride,
};

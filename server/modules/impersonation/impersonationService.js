'use strict';

const { signToken } = require('../../config/jwt');
const { env } = require('../../core/config/env');
const { OrganizationMembership, Organization, User } = require('../../models');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function startImpersonation({ membershipId, reason, actorUserId }) {
  const membership = await OrganizationMembership.findOne({
    where: { id: membershipId, status: 'active', deletedAt: null },
    include: [{ model: Organization, as: 'organization' }],
  });
  if (!membership) throw invalid('Membership not found', 404);
  if (membership.membershipType !== 'client') {
    throw invalid('Impersonation is only available for client memberships in Phase 1');
  }

  const targetUser = await User.findByPk(membership.userId, { attributes: { exclude: ['passwordHash'] } });
  if (!targetUser || !targetUser.isActive) throw invalid('Target user not found or inactive', 404);

  const token = signToken(
    { id: targetUser.id, imp: { by: actorUserId, reason } },
    { expiresIn: env.IMPERSONATION_TOKEN_TTL }
  );

  return {
    token, user: targetUser, membership, organization: membership.organization,
  };
}

module.exports = { startImpersonation };

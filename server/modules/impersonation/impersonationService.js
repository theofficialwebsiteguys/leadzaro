'use strict';

const { signToken } = require('../../config/jwt');
const { env } = require('../../core/config/env');
const { generateRawToken, hashToken } = require('../../core/security/tokens');
const {
  OrganizationMembership, Organization, User, AuthSession,
} = require('../../models');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Lists client members impersonable by the given agency organization —
 * scoped by `managingAgencyOrganizationId`, not just `type: 'client'`.
 * Without this, any agency administrator could enumerate and impersonate
 * members of a client organization no relationship ties them to (found
 * during the mandated Phase 1 final review).
 */
async function listCandidates(agencyOrganizationId) {
  const memberships = await OrganizationMembership.findAll({
    where: { membershipType: 'client', status: 'active', deletedAt: null },
    include: [
      {
        model: Organization,
        as: 'organization',
        where: { type: 'client', status: 'active', managingAgencyOrganizationId: agencyOrganizationId },
      },
      { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
    ],
    order: [['createdAt', 'ASC']],
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    organizationName: m.organization.name,
    userName: m.user.name,
    userEmail: m.user.email,
    title: m.title,
  }));
}

async function startImpersonation({
  membershipId, reason, actorUserId, agencyOrganizationId,
}) {
  const membership = await OrganizationMembership.findOne({
    where: { id: membershipId, status: 'active', deletedAt: null },
    include: [{ model: Organization, as: 'organization' }],
  });
  if (!membership) throw invalid('Membership not found', 404);
  if (membership.membershipType !== 'client') {
    throw invalid('Impersonation is only available for client memberships in Phase 1');
  }
  if (membership.organization.managingAgencyOrganizationId !== agencyOrganizationId) {
    throw invalid('That client organization is not managed by your agency', 403);
  }

  const targetUser = await User.findByPk(membership.userId, { attributes: { exclude: ['passwordHash'] } });
  if (!targetUser || !targetUser.isActive) throw invalid('Target user not found or inactive', 404);

  // Backed by a real, revocable AuthSession (never set as a cookie — the
  // raw token here is bookkeeping only) so an administrator can kill an
  // in-progress impersonation via the same "revoke sessions" action used
  // for any other session, rather than waiting out the TTL.
  const expiresAt = new Date(Date.now() + env.IMPERSONATION_TOKEN_TTL_MINUTES * 60 * 1000);
  const session = await AuthSession.create({
    userId: targetUser.id,
    tokenHash: hashToken(generateRawToken()),
    expiresAt,
    lastSeenAt: new Date(),
    impersonatedByUserId: actorUserId,
  });

  const token = signToken(
    { id: targetUser.id, imp: { by: actorUserId, reason, sessionId: session.id } },
    { expiresIn: `${env.IMPERSONATION_TOKEN_TTL_MINUTES}m` }
  );

  return {
    token, user: targetUser, membership, organization: membership.organization, session,
  };
}

module.exports = { startImpersonation, listCandidates };

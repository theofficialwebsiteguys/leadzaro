'use strict';

const bcrypt = require('bcryptjs');
const {
  sequelize, Invitation, Organization, Role, OrganizationMembership, MembershipRole, User,
} = require('../../models');
const { generateRawToken, hashToken } = require('../../core/security/tokens');
const { getEmailAdapter } = require('../../core/notifications/emailAdapter');
const { env } = require('../../core/config/env');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function validateRoleKeys(roleKeys, membershipType) {
  if (!Array.isArray(roleKeys) || roleKeys.length === 0) {
    throw invalid('At least one role must be selected');
  }
  const roles = await Role.findAll({ where: { key: roleKeys } });
  if (roles.length !== roleKeys.length) {
    throw invalid('One or more role keys are invalid');
  }
  const mismatched = roles.find((r) => r.scope !== membershipType);
  if (mismatched) {
    throw invalid(`Role "${mismatched.key}" cannot be assigned to a ${membershipType} membership`);
  }
  return roles;
}

async function sendInvitationEmail(invitation, rawToken, organization) {
  const link = `${env.APP_BASE_URL}/accept-invite?token=${rawToken}`;
  await getEmailAdapter().send({
    to: invitation.email,
    subject: `You're invited to join ${organization.name} on Leadzaro`,
    text: `You've been invited to join ${organization.name} as a ${invitation.membershipType}.\nAccept your invitation: ${link}\nThis link expires in ${env.INVITATION_TOKEN_TTL_HOURS} hours.`,
  });
}

async function createInvitation({
  organizationId, email, membershipType, roleKeys, invitedByUserId,
}) {
  await validateRoleKeys(roleKeys, membershipType);
  const organization = await Organization.findByPk(organizationId);
  if (!organization) throw invalid('Organization not found', 404);

  const normalizedEmail = email.toLowerCase();

  const existingPending = await Invitation.findOne({
    where: { organizationId, email: normalizedEmail, status: 'pending' },
  });
  if (existingPending) {
    await existingPending.update({ status: 'revoked', revokedAt: new Date(), revokedByUserId: invitedByUserId });
  }

  const rawToken = generateRawToken();
  const invitation = await Invitation.create({
    organizationId,
    email: normalizedEmail,
    membershipType,
    roleKeys,
    tokenHash: hashToken(rawToken),
    status: 'pending',
    invitedByUserId,
    expiresAt: new Date(Date.now() + env.INVITATION_TOKEN_TTL_HOURS * 60 * 60 * 1000),
  });

  await sendInvitationEmail(invitation, rawToken, organization);
  return invitation;
}

function listForOrganization(organizationId, { status } = {}) {
  const where = { organizationId };
  if (status) where.status = status;
  return Invitation.findAll({ where, order: [['createdAt', 'DESC']] });
}

async function getInOrganization(invitationId, organizationId) {
  const invitation = await Invitation.findOne({ where: { id: invitationId, organizationId } });
  if (!invitation) throw invalid('Invitation not found', 404);
  return invitation;
}

async function resendInvitation(invitationId, organizationId, actorUserId) {
  const invitation = await getInOrganization(invitationId, organizationId);
  if (invitation.status !== 'pending') {
    throw invalid('Only a pending invitation can be resent');
  }
  const organization = await Organization.findByPk(organizationId);
  const rawToken = generateRawToken();
  await invitation.update({
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + env.INVITATION_TOKEN_TTL_HOURS * 60 * 60 * 1000),
  });
  await sendInvitationEmail(invitation, rawToken, organization);
  return invitation;
}

async function revokeInvitation(invitationId, organizationId, actorUserId) {
  const invitation = await getInOrganization(invitationId, organizationId);
  if (invitation.status !== 'pending') {
    throw invalid('Only a pending invitation can be revoked');
  }
  await invitation.update({ status: 'revoked', revokedAt: new Date(), revokedByUserId: actorUserId });
  return invitation;
}

async function findValidInvitationByToken(rawToken) {
  const invitation = await Invitation.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!invitation) throw invalid('This invitation link is invalid or has expired', 400);
  if (invitation.status === 'accepted') throw invalid('This invitation has already been accepted', 400);
  if (invitation.status === 'revoked') throw invalid('This invitation has been revoked', 400);
  if (invitation.expiresAt < new Date()) {
    if (invitation.status !== 'expired') await invitation.update({ status: 'expired' });
    throw invalid('This invitation link has expired', 400);
  }
  return invitation;
}

async function lookupByToken(rawToken) {
  const invitation = await findValidInvitationByToken(rawToken);
  const organization = await Organization.findByPk(invitation.organizationId, { attributes: ['name'] });
  const existingUser = await User.findOne({ where: { email: invitation.email }, attributes: ['id'] });
  return {
    email: invitation.email,
    membershipType: invitation.membershipType,
    organizationName: organization?.name,
    requiresPassword: !existingUser,
  };
}

/**
 * Accepts an invitation, creating a new User account when the invited
 * email has none, or attaching an additional membership to an already-
 * authenticated matching user. Returns the resulting user + membership so
 * the controller can issue a session.
 */
async function acceptInvitation({
  rawToken, name, password, requestingUser,
}) {
  return sequelize.transaction(async (transaction) => {
    const invitation = await findValidInvitationByToken(rawToken);

    let user = await User.findOne({ where: { email: invitation.email }, transaction });

    if (user) {
      if (!requestingUser || requestingUser.id !== user.id) {
        throw invalid('An account with this email already exists. Please log in first, then open this invitation link again.', 409);
      }
    } else {
      if (!name || !password) {
        throw invalid('Name and password are required to accept this invitation');
      }
      const passwordHash = await bcrypt.hash(password, 10);
      user = await User.create({
        name,
        email: invitation.email,
        passwordHash,
        role: 'user',
        emailVerifiedAt: new Date(),
      }, { transaction });
    }

    if (!user.emailVerifiedAt) {
      await user.update({ emailVerifiedAt: new Date() }, { transaction });
    }

    const existingMembership = await OrganizationMembership.findOne({
      where: { organizationId: invitation.organizationId, userId: user.id },
      transaction,
    });
    if (existingMembership && existingMembership.status === 'active') {
      throw invalid('You are already a member of this organization', 409);
    }

    const roles = await Role.findAll({ where: { key: invitation.roleKeys }, transaction });

    let membership = existingMembership;
    if (membership) {
      await membership.update({
        status: 'active', membershipType: invitation.membershipType, acceptedAt: new Date(),
      }, { transaction });
    } else {
      membership = await OrganizationMembership.create({
        organizationId: invitation.organizationId,
        userId: user.id,
        status: 'active',
        membershipType: invitation.membershipType,
        invitedAt: invitation.createdAt,
        acceptedAt: new Date(),
      }, { transaction });
    }

    await MembershipRole.destroy({ where: { membershipId: membership.id }, transaction });
    await MembershipRole.bulkCreate(
      roles.map((role) => ({ membershipId: membership.id, roleId: role.id })),
      { transaction }
    );

    await invitation.update({
      status: 'accepted', acceptedAt: new Date(), acceptedByUserId: user.id,
    }, { transaction });

    return { user, membership, invitation };
  });
}

module.exports = {
  createInvitation,
  listForOrganization,
  getInOrganization,
  resendInvitation,
  revokeInvitation,
  lookupByToken,
  acceptInvitation,
};

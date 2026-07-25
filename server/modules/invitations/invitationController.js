const invitationService = require('./invitationService');
const { createSession, setSessionCookie } = require('../../core/authentication/sessionService');
const { recordAudit } = require('../../core/audit/auditService');
const { sanitizeUser } = require('../../services/authService');
const { success, created, error } = require('../../utils/response');

async function create(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const invitation = await invitationService.createInvitation({
      organizationId: orgId,
      email: req.body.email,
      membershipType: req.body.membershipType,
      roleKeys: req.body.roleKeys,
      invitedByUserId: req.user.id,
    });

    await recordAudit({
      organizationId: orgId,
      actorUserId: req.user.id,
      action: 'invitation.created',
      targetType: 'Invitation',
      targetId: invitation.id,
      metadata: { email: invitation.email, membershipType: invitation.membershipType, roleKeys: invitation.roleKeys },
      req,
    });

    return created(res, { invitation }, 'Invitation sent');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const invitations = await invitationService.listForOrganization(req.context.organization.id, {
      status: req.query.status,
    });
    return success(res, { invitations });
  } catch (err) {
    next(err);
  }
}

async function resend(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const invitation = await invitationService.resendInvitation(req.params.id, orgId, req.user.id);
    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'invitation.resent', targetType: 'Invitation', targetId: invitation.id, req,
    });
    return success(res, { invitation }, 'Invitation resent');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function revoke(req, res, next) {
  try {
    const orgId = req.context.organization.id;
    const invitation = await invitationService.revokeInvitation(req.params.id, orgId, req.user.id);
    await recordAudit({
      organizationId: orgId, actorUserId: req.user.id, action: 'invitation.revoked', targetType: 'Invitation', targetId: invitation.id, req,
    });
    return success(res, { invitation }, 'Invitation revoked');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function lookup(req, res, next) {
  try {
    const info = await invitationService.lookupByToken(req.query.token);
    return success(res, info);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function accept(req, res, next) {
  try {
    const { user, membership, invitation } = await invitationService.acceptInvitation({
      rawToken: req.body.token,
      name: req.body.name,
      password: req.body.password,
      requestingUser: req.user,
    });

    const { accessToken, rawSessionToken } = await createSession(user, req);
    setSessionCookie(res, rawSessionToken);

    await recordAudit({
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      action: 'invitation.accepted',
      targetType: 'Invitation',
      targetId: invitation.id,
      metadata: { membershipId: membership.id },
      req,
    });

    return success(res, { token: accessToken, user: sanitizeUser(user) }, 'Invitation accepted');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = {
  create, list, resend, revoke, lookup, accept,
};

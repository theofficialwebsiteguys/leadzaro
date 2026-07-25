const { startImpersonation, listCandidates } = require('./impersonationService');
const { recordAudit } = require('../../core/audit/auditService');
const { revokeSession } = require('../../core/authentication/sessionService');
const { sanitizeUser } = require('../../services/authService');
const { success, error } = require('../../utils/response');
const { AuthSession } = require('../../models');

async function candidates(req, res, next) {
  try {
    if (req.context.organization.type !== 'agency') {
      return error(res, 'Impersonation is only available to agency administrators', 403);
    }
    const items = await listCandidates(req.context.organization.id);
    return success(res, { candidates: items });
  } catch (err) {
    next(err);
  }
}

async function start(req, res, next) {
  try {
    if (req.context.organization.type !== 'agency') {
      return error(res, 'Impersonation is only available to agency administrators', 403);
    }

    const { membershipId, reason } = req.body;
    const {
      token, user, membership, organization,
    } = await startImpersonation({
      membershipId, reason, actorUserId: req.user.id, agencyOrganizationId: req.context.organization.id,
    });

    await recordAudit({
      organizationId: organization.id,
      actorUserId: req.user.id,
      action: 'impersonation.start',
      targetType: 'OrganizationMembership',
      targetId: membership.id,
      metadata: { reason, targetUserId: user.id },
      req,
    });

    return success(res, {
      token,
      user: sanitizeUser(user),
      impersonation: { reason, organization: { id: organization.id, name: organization.name } },
    }, 'Impersonation started');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function end(req, res, next) {
  try {
    if (!req.impersonation) {
      return error(res, 'Not currently impersonating', 400);
    }

    if (req.impersonation.sessionId) {
      const session = await AuthSession.findByPk(req.impersonation.sessionId);
      if (session && !session.revokedAt) {
        await revokeSession(session, { revokedByUserId: req.impersonation.byUserId, reason: 'impersonation_ended' });
      }
    }

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.impersonation.byUserId,
      action: 'impersonation.end',
      targetType: 'User',
      targetId: req.user.id,
      metadata: { reason: req.impersonation.reason },
      req,
    });

    return success(res, {}, 'Impersonation ended');
  } catch (err) {
    next(err);
  }
}

module.exports = { candidates, start, end };

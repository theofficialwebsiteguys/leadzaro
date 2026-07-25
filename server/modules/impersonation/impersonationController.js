const { startImpersonation, listCandidates } = require('./impersonationService');
const { recordAudit } = require('../../core/audit/auditService');
const { sanitizeUser } = require('../../services/authService');
const { success, error } = require('../../utils/response');

async function candidates(req, res, next) {
  try {
    if (req.context.organization.type !== 'agency') {
      return error(res, 'Impersonation is only available to agency administrators', 403);
    }
    const items = await listCandidates();
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
    } = await startImpersonation({ membershipId, reason, actorUserId: req.user.id });

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

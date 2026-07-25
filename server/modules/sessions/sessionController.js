const { AuthSession, OrganizationMembership } = require('../../models');
const { revokeSession } = require('../../core/authentication/sessionService');
const { recordAudit } = require('../../core/audit/auditService');
const { env } = require('../../core/config/env');
const { success, notFound, forbidden } = require('../../utils/response');
const { hashToken } = require('../../core/security/tokens');

async function listMine(req, res, next) {
  try {
    const currentRawToken = req.cookies?.[env.SESSION_COOKIE_NAME];
    const currentHash = currentRawToken ? hashToken(currentRawToken) : null;

    const sessions = await AuthSession.findAll({
      where: { userId: req.user.id },
      order: [['lastSeenAt', 'DESC']],
      attributes: ['id', 'userAgent', 'ipAddress', 'lastSeenAt', 'expiresAt', 'revokedAt', 'createdAt', 'tokenHash'],
    });

    const shaped = sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      createdAt: s.createdAt,
      isCurrent: currentHash === s.tokenHash,
    }));

    return success(res, { sessions: shaped });
  } catch (err) {
    next(err);
  }
}

async function revokeMine(req, res, next) {
  try {
    const session = await AuthSession.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!session) return notFound(res, 'Session not found');

    await revokeSession(session, { revokedByUserId: req.user.id, reason: 'user_revoked' });
    await recordAudit({
      actorUserId: req.user.id, action: 'session.revoked', targetType: 'AuthSession', targetId: session.id, req,
    });

    return success(res, {}, 'Session revoked');
  } catch (err) {
    next(err);
  }
}

async function revokeAllForUser(req, res, next) {
  try {
    const { userId } = req.params;
    const membership = await OrganizationMembership.findOne({
      where: { userId, organizationId: req.context.organization.id, status: 'active', deletedAt: null },
    });
    if (!membership) return forbidden(res, 'That user is not a member of your organization');

    const sessions = await AuthSession.findAll({ where: { userId, revokedAt: null } });
    await Promise.all(sessions.map((s) => revokeSession(s, { revokedByUserId: req.user.id, reason: 'admin_revoked' })));

    await recordAudit({
      organizationId: req.context.organization.id,
      actorUserId: req.user.id,
      action: 'session.revoked_all_by_admin',
      targetType: 'User',
      targetId: userId,
      metadata: { count: sessions.length },
      req,
    });

    return success(res, { revokedCount: sessions.length }, 'Sessions revoked');
  } catch (err) {
    next(err);
  }
}

module.exports = { listMine, revokeMine, revokeAllForUser };

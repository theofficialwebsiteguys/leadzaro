const { verifyAccessToken } = require('../core/authentication/sessionService');
const { unauthorized } = require('../utils/response');
const { User, AuthSession } = require('../models');

async function loadUserFromBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  const decoded = verifyAccessToken(token);

  const user = await User.findByPk(decoded.id, {
    attributes: { exclude: ['passwordHash'] },
  });
  if (!user || !user.isActive) return null;

  if (decoded.imp) {
    // Impersonation is checked against its backing AuthSession on every
    // request (unlike a normal access token, which only re-validates on
    // refresh) so an administrator can forcibly end another admin's
    // in-progress impersonation rather than waiting out the token's TTL.
    const session = decoded.imp.sessionId ? await AuthSession.findByPk(decoded.imp.sessionId) : null;
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    return { user, impersonation: { byUserId: decoded.imp.by, reason: decoded.imp.reason, sessionId: decoded.imp.sessionId } };
  }

  return { user, impersonation: null };
}

async function authenticate(req, res, next) {
  try {
    const result = await loadUserFromBearerToken(req);
    if (!result) return unauthorized(res, 'No token provided');

    req.user = result.user;
    req.impersonation = result.impersonation;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return unauthorized(res, 'Invalid or expired token');
    }
    next(err);
  }
}

// Populates req.user when a valid bearer token is present, but never
// rejects the request otherwise — used by endpoints that behave
// differently for anonymous vs. already-logged-in callers (e.g.
// invitation acceptance).
async function optionalAuthenticate(req, res, next) {
  try {
    const result = await loadUserFromBearerToken(req);
    if (result) {
      req.user = result.user;
      req.impersonation = result.impersonation;
    }
    next();
  } catch {
    next();
  }
}

function blockDuringImpersonation(req, res, next) {
  if (req.impersonation) {
    return require('../utils/response').forbidden(res, 'This action is not available while impersonating another user');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return require('../utils/response').forbidden(res, 'Admin access required');
  }
  next();
}

module.exports = {
  authenticate, optionalAuthenticate, blockDuringImpersonation, requireAdmin,
};

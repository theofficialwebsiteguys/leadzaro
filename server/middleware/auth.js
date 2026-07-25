const { verifyAccessToken } = require('../core/authentication/sessionService');
const { unauthorized } = require('../utils/response');
const { User } = require('../models');

async function loadUserFromBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];
  const decoded = verifyAccessToken(token);

  const user = await User.findByPk(decoded.id, {
    attributes: { exclude: ['passwordHash'] },
  });
  if (!user || !user.isActive) return null;

  return { user, impersonation: decoded.imp ? { byUserId: decoded.imp.by, reason: decoded.imp.reason } : null };
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

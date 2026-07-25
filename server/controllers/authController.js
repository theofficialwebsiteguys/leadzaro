const bcrypt = require('bcryptjs');
const { register, login, sanitizeUser } = require('../services/authService');
const { requestPasswordReset, confirmPasswordReset } = require('../services/passwordResetService');
const { requestEmailVerification, confirmEmailVerification } = require('../services/emailVerificationService');
const {
  createSession, setSessionCookie, clearSessionCookie, findActiveSessionByRawToken, touchSession,
  revokeSession, signAccessToken,
} = require('../core/authentication/sessionService');
const { recordAudit } = require('../core/audit/auditService');
const { env } = require('../core/config/env');
const { success, created, error } = require('../utils/response');
const { User, UserSubscription, SubscriptionPlan } = require('../models');

async function registerUser(req, res, next) {
  try {
    if (!env.FEATURE_PUBLIC_REGISTRATION) {
      return error(res, 'Public registration is disabled. Ask an administrator for an invitation.', 403);
    }
    const user = await register(req.body);
    const { accessToken, rawSessionToken } = await createSession(user, req);
    setSessionCookie(res, rawSessionToken);
    await recordAudit({ actorUserId: user.id, action: 'auth.register', targetType: 'User', targetId: user.id, req });
    return created(res, { token: accessToken, user }, 'Account created successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function loginUser(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await login(email, password);
    const { accessToken, rawSessionToken } = await createSession(user, req);
    setSessionCookie(res, rawSessionToken);
    await recordAudit({ actorUserId: user.id, action: 'auth.login', targetType: 'User', targetId: user.id, req });
    return success(res, { token: accessToken, user: sanitizeUser(user) }, 'Login successful');
  } catch (err) {
    if (err.statusCode) {
      await recordAudit({
        action: 'auth.login_failed', targetType: 'User', metadata: { email: req.body?.email }, req,
      });
      return error(res, err.message, err.statusCode);
    }
    next(err);
  }
}

async function refreshSession(req, res, next) {
  try {
    const rawToken = req.cookies?.[env.SESSION_COOKIE_NAME];
    const session = await findActiveSessionByRawToken(rawToken);
    if (!session) {
      clearSessionCookie(res);
      return error(res, 'Session expired or revoked', 401);
    }

    const user = await User.findByPk(session.userId, { attributes: { exclude: ['passwordHash'] } });
    if (!user || !user.isActive) {
      clearSessionCookie(res);
      return error(res, 'Session expired or revoked', 401);
    }

    await touchSession(session);
    const accessToken = signAccessToken(user);
    return success(res, { token: accessToken, user });
  } catch (err) {
    next(err);
  }
}

async function logoutUser(req, res, next) {
  try {
    const rawToken = req.cookies?.[env.SESSION_COOKIE_NAME];
    const session = await findActiveSessionByRawToken(rawToken);
    if (session) {
      await revokeSession(session, { revokedByUserId: session.userId, reason: 'logout' });
      await recordAudit({ actorUserId: session.userId, action: 'auth.logout', targetType: 'AuthSession', targetId: session.id, req });
    }
    clearSessionCookie(res);
    return success(res, {}, 'Logged out');
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['passwordHash'] },
      include: [
        {
          model: UserSubscription,
          as: 'subscription',
          include: [{ model: SubscriptionPlan, as: 'plan' }],
        },
      ],
    });
    return success(res, { user });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const {
      name, companyName, salespersonType, targetIndustry, serviceArea,
    } = req.body;

    await req.user.update({
      name, companyName, salespersonType, targetIndustry, serviceArea,
    });

    const updated = await User.findByPk(req.user.id, {
      attributes: { exclude: ['passwordHash'] },
    });

    return success(res, { user: sanitizeUser(updated) }, 'Profile updated');
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findByPk(req.user.id);
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);

    if (!valid) {
      return error(res, 'Current password is incorrect', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await user.update({ passwordHash });
    await recordAudit({ actorUserId: user.id, action: 'auth.password_changed', targetType: 'User', targetId: user.id, req });

    return success(res, {}, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
}

async function requestPasswordResetHandler(req, res, next) {
  try {
    await requestPasswordReset(req.body.email);
    return success(res, {}, 'If an account exists for that email, a reset link has been sent.');
  } catch (err) {
    next(err);
  }
}

async function confirmPasswordResetHandler(req, res, next) {
  try {
    const user = await confirmPasswordReset(req.body.token, req.body.newPassword);
    await recordAudit({ actorUserId: user.id, action: 'auth.password_reset', targetType: 'User', targetId: user.id, req });
    return success(res, {}, 'Password reset successfully. You can now log in.');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

async function requestEmailVerificationHandler(req, res, next) {
  try {
    await requestEmailVerification(req.user);
    return success(res, {}, 'Verification email sent.');
  } catch (err) {
    next(err);
  }
}

async function confirmEmailVerificationHandler(req, res, next) {
  try {
    const user = await confirmEmailVerification(req.body.token);
    await recordAudit({ actorUserId: user.id, action: 'auth.email_verified', targetType: 'User', targetId: user.id, req });
    return success(res, {}, 'Email verified.');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    next(err);
  }
}

module.exports = {
  registerUser,
  loginUser,
  refreshSession,
  logoutUser,
  getMe,
  updateProfile,
  changePassword,
  requestPasswordResetHandler,
  confirmPasswordResetHandler,
  requestEmailVerificationHandler,
  confirmEmailVerificationHandler,
};

'use strict';

const { Op } = require('sequelize');
const { signToken, verifyToken } = require('../../config/jwt');
const { env } = require('../config/env');
const { generateRawToken, hashToken } = require('../security/tokens');
const { AuthSession } = require('../../models');

function signAccessToken(user) {
  return signToken({ id: user.id }, { expiresIn: env.ACCESS_TOKEN_TTL });
}

/**
 * Creates a new revocable session: a short-lived JWT access token (held
 * in memory by the frontend, attached via the existing Authorization
 * bearer interceptor) plus a long-lived opaque session token whose
 * SHA-256 hash is persisted in AuthSession. Only the raw session token is
 * ever handed back to the caller — to be set as an HttpOnly cookie — so a
 * database read alone can never impersonate a session.
 */
async function createSession(user, req) {
  const rawSessionToken = generateRawToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const session = await AuthSession.create({
    userId: user.id,
    tokenHash: hashToken(rawSessionToken),
    userAgent: req?.headers?.['user-agent']?.slice(0, 255) || null,
    ipAddress: req?.ip || null,
    expiresAt,
    lastSeenAt: new Date(),
  });

  return { accessToken: signAccessToken(user), rawSessionToken, session };
}

function setSessionCookie(res, rawSessionToken) {
  res.cookie(env.SESSION_COOKIE_NAME, rawSessionToken, {
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/api' });
}

async function findActiveSessionByRawToken(rawToken) {
  if (!rawToken) return null;
  const session = await AuthSession.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) return null;
  return session;
}

function touchSession(session) {
  return session.update({ lastSeenAt: new Date() });
}

function revokeSession(session, { revokedByUserId = null, reason = null } = {}) {
  return session.update({ revokedAt: new Date(), revokedByUserId, revokedReason: reason });
}

/**
 * Revokes every active session for a user except one (typically the
 * session making the request). Used after a password change/reset so a
 * session hijacked before the credential change doesn't survive it —
 * without that, changing a compromised password would leave an
 * attacker's existing session valid indefinitely.
 */
async function revokeAllSessionsForUser(userId, { exceptSessionId = null, reason = null } = {}) {
  const where = { userId, revokedAt: null };
  if (exceptSessionId) where.id = { [Op.ne]: exceptSessionId };
  await AuthSession.update(
    { revokedAt: new Date(), revokedByUserId: userId, revokedReason: reason },
    { where }
  );
}

module.exports = {
  signAccessToken,
  verifyAccessToken: verifyToken,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  findActiveSessionByRawToken,
  touchSession,
  revokeSession,
  revokeAllSessionsForUser,
};

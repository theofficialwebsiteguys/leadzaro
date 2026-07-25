const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_replace_in_production';
// Deprecated: access tokens are now short-lived (see core/config/env.js
// ACCESS_TOKEN_TTL, default 15m) and backed by a revocable AuthSession
// rather than a single long-lived JWT. JWT_EXPIRES_IN is only honored
// when a caller doesn't pass an explicit `options.expiresIn` override.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, ...options });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken, JWT_SECRET };

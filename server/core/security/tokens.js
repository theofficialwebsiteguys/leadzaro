'use strict';

const crypto = require('node:crypto');

/**
 * Shared secure-token primitives used by invitations, password reset,
 * email verification, and auth sessions. The raw token is only ever
 * returned to the caller once (to embed in a link or cookie); only its
 * SHA-256 hash is persisted, so a database leak never exposes usable
 * tokens.
 */

function generateRawToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function tokensMatch(rawToken, hash) {
  const candidate = hashToken(rawToken);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateRawToken, hashToken, tokensMatch };

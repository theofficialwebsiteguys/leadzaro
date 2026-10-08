'use strict';

const crypto = require('node:crypto');
const { env } = require('../config/env');

/**
 * Short-lived, HMAC-signed links for files held by LocalDiskStorageProvider
 * — the local equivalent of a GCS signed URL. The link itself is the
 * authorization (so an <img src> works without an Authorization header),
 * which is exactly why it expires and is only ever minted by
 * fileService after the requester's access to the File row has been
 * checked.
 *
 * The signing key is derived from, but never equal to, the access-token
 * secret, so a file token can never be replayed as an auth token or vice
 * versa.
 */
const SIGNING_KEY = crypto.createHash('sha256').update(`leadzaro-file-url:${env.ACCESS_TOKEN_SECRET}`).digest();

// Only formats a browser renders without running script are ever served
// inline from our origin. Everything else (HTML, SVG, office docs, ...)
// is forced to download, so an uploaded file can never execute in the
// app's origin.
const INLINE_SAFE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf']);

function hmac(body) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(body).digest();
}

function signFileToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body).toString('base64url')}`;
}

function verifyFileToken(token) {
  if (typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = hmac(body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.k !== 'string' || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

function isInlineSafe(contentType) {
  return INLINE_SAFE_TYPES.has(contentType);
}

module.exports = { signFileToken, verifyFileToken, isInlineSafe };

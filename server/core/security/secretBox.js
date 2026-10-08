'use strict';

const crypto = require('node:crypto');
const { env } = require('../config/env');

/**
 * Encrypts small secrets (integration credentials) for storage at rest
 * with AES-256-GCM. The ciphertext is bound to a caller-supplied context
 * (e.g. "<agencyId>:namecheap") as additional authenticated data, so a
 * value copied onto another row fails to decrypt instead of quietly
 * working there.
 *
 * Key: INTEGRATION_SECRETS_KEY (32 bytes, base64 or hex). Outside
 * production only, a key is derived from JWT_SECRET so a local setup works
 * without another secret; production refuses to store credentials until a
 * dedicated key is configured. The stored value carries a short key id, so
 * a changed key reads as "re-enter the credentials", never as garbage.
 */

const VERSION = 'v1';
let cachedKey;

class SecretsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecretsUnavailableError';
    this.statusCode = 503;
  }
}

class SecretsKeyChangedError extends Error {
  constructor() {
    super('The saved credentials were encrypted with a different key and can no longer be read. Enter them again.');
    this.name = 'SecretsKeyChangedError';
    this.statusCode = 409;
  }
}

function decodeConfiguredKey(raw) {
  const decoded = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : null;
}

function resolveKey() {
  if (cachedKey) return cachedKey;
  let key = null;
  let source;
  if (env.INTEGRATION_SECRETS_KEY) {
    key = decodeConfiguredKey(env.INTEGRATION_SECRETS_KEY);
    source = key ? 'configured' : 'invalid';
  } else if (!env.IS_PRODUCTION) {
    key = Buffer.from(crypto.hkdfSync('sha256', env.ACCESS_TOKEN_SECRET, 'leadzaro', 'integration-secrets-v1', 32));
    source = 'derived';
  } else {
    source = 'missing';
  }
  const keyId = key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) : null;
  cachedKey = { key, keyId, source };
  return cachedKey;
}

/** What the admin UI can say about key setup — never the key itself. */
function keyStatus() {
  const { source } = resolveKey();
  return { source, canStore: source === 'configured' || source === 'derived' };
}

function requireKey() {
  const resolved = resolveKey();
  if (!resolved.key) {
    throw new SecretsUnavailableError(resolved.source === 'invalid'
      ? 'INTEGRATION_SECRETS_KEY is set but is not a valid 32-byte key, so credentials cannot be stored.'
      : 'This server has no INTEGRATION_SECRETS_KEY configured, so credentials cannot be stored yet.');
  }
  return resolved;
}

function encryptJson(value, context) {
  const { key, keyId } = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(context)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, keyId, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptJson(stored, context) {
  const { key, keyId } = requireKey();
  const parts = String(stored || '').split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) throw new SecretsKeyChangedError();
  const [, storedKeyId, iv, tag, ciphertext] = parts;
  if (storedKeyId !== keyId) throw new SecretsKeyChangedError();
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(String(context)));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new SecretsKeyChangedError();
  }
}

/** Test hook: env changes between suites. */
function resetKeyCache() {
  cachedKey = undefined;
}

module.exports = {
  encryptJson, decryptJson, keyStatus, resetKeyCache, SecretsUnavailableError, SecretsKeyChangedError,
};

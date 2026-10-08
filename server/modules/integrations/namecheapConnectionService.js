'use strict';

const net = require('node:net');
const https = require('node:https');
const { IntegrationConnection } = require('../../models');
const access = require('../../core/domains/domainRegistryAccess');
const {
  encryptJson, decryptJson, keyStatus, SecretsKeyChangedError,
} = require('../../core/security/secretBox');
const { NamecheapRegistrarReader, RegistrarError } = require('../../core/integrations/namecheap/namecheapRegistrarReader');

/**
 * The workspace's Namecheap connection (ADR 0009): credentials in, status
 * out. The API key is write-only — encrypted at rest, decrypted only in
 * memory to build a reader, and never returned, logged or audited.
 * `status` becomes 'connected' only after a real API call succeeds.
 */

const PROVIDER = 'namecheap';
const AUTH_ERROR_KINDS = new Set(['ip_not_allowed', 'client_ip_invalid', 'invalid_credentials', 'account_unavailable']);
const SYNC_LOCK_MS = 30 * 60 * 1000;

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function defaultReaderFactory(connection, credentials) {
  return new NamecheapRegistrarReader(credentials, { environment: connection.environment, budgetKey: connection.id });
}
let readerFactory = defaultReaderFactory;

/** Tests substitute a fake transport-backed reader; production never calls this. */
function setReaderFactoryForTests(factory) {
  readerFactory = factory || defaultReaderFactory;
}

function secretContext(connection) {
  return `${connection.agencyOrganizationId}:${PROVIDER}`;
}

function accountKeyFor(connection) {
  return `${connection.environment}:${String(connection.accountUserName || '').toLowerCase()}`;
}

function getConnection(agencyOrganizationId) {
  return access.connections.findOne(agencyOrganizationId, { where: { provider: PROVIDER } });
}

function readerFor(connection) {
  const { apiKey } = decryptJson(connection.credentialsCiphertext, secretContext(connection));
  return readerFactory(connection, {
    apiUser: connection.apiUser, apiKey, userName: connection.accountUserName, clientIp: connection.clientIp,
  });
}

function isSyncing(connection, now = new Date()) {
  return Boolean(connection?.syncLockedUntil && new Date(connection.syncLockedUntil) > now);
}

function errorFields(err, now = new Date()) {
  if (err instanceof SecretsKeyChangedError) {
    return {
      lastErrorKind: 'credentials_unreadable', lastErrorMessage: err.message, lastErrorProviderCode: null, lastErrorAt: now,
    };
  }
  if (err instanceof RegistrarError) {
    return {
      lastErrorKind: err.kind, lastErrorMessage: err.message, lastErrorProviderCode: err.providerCode, lastErrorAt: now,
    };
  }
  return {
    lastErrorKind: 'unexpected', lastErrorMessage: 'Something went wrong talking to Namecheap. Try again, and check the server logs if it keeps happening.', lastErrorProviderCode: null, lastErrorAt: now,
  };
}

/** A lock that expired while still marked running means the process stopped mid-sync. */
function syncStatusFor(connection, now) {
  if (isSyncing(connection, now)) return 'running';
  if (connection.lastSyncStatus === 'running') return 'interrupted';
  return connection.lastSyncStatus;
}

/** Everything the Settings screen shows. Never the API key, never the ciphertext. */
function toStatusDto(connection, now = new Date()) {
  const base = {
    provider: PROVIDER,
    secretsKey: keyStatus(),
  };
  if (!connection) {
    return {
      ...base, configured: false, status: 'not_configured', hasApiKey: false, syncing: false, lastError: null,
    };
  }
  return {
    ...base,
    configured: Boolean(connection.credentialsCiphertext),
    status: connection.status,
    environment: connection.environment,
    apiUser: connection.apiUser,
    accountUserName: connection.accountUserName,
    clientIp: connection.clientIp,
    hasApiKey: Boolean(connection.credentialsCiphertext),
    credentialsUpdatedAt: connection.credentialsUpdatedAt,
    lastTestedAt: connection.lastTestedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
    lastSyncStartedAt: connection.lastSyncStartedAt,
    lastSyncFinishedAt: connection.lastSyncFinishedAt,
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
    lastSyncStatus: syncStatusFor(connection, now),
    lastSyncTrigger: connection.lastSyncTrigger,
    lastSyncSummary: connection.lastSyncSummary || {},
    syncing: isSyncing(connection, now),
    lastError: connection.lastErrorKind ? {
      kind: connection.lastErrorKind, message: connection.lastErrorMessage, providerCode: connection.lastErrorProviderCode, at: connection.lastErrorAt,
    } : null,
    account: connection.accountSnapshot || {},
  };
}

// ─── Validation ────────────────────────────────────────────────────────

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,20}$/; // Namecheap: ApiUser/UserName max 20 characters.
const API_KEY_PATTERN = /^[A-Za-z0-9]{16,50}$/; // ApiKey max 50 characters.

function isPrivateIpv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}

function normalizeCredentialsInput(input, existing) {
  const apiUser = String(input.apiUser ?? existing?.apiUser ?? '').trim();
  if (!USERNAME_PATTERN.test(apiUser)) throw invalid('API user must be your Namecheap username (up to 20 letters, numbers, dots, dashes or underscores).');
  const userName = String(input.userName ?? '').trim() || apiUser;
  if (!USERNAME_PATTERN.test(userName)) throw invalid('Username must be a Namecheap username (up to 20 characters).');

  const clientIp = String(input.clientIp ?? existing?.clientIp ?? '').trim();
  if (!net.isIPv4(clientIp)) throw invalid('Client IP must be an IPv4 address such as 203.0.113.10 — Namecheap only accepts IPv4.');
  if (isPrivateIpv4(clientIp)) throw invalid('That is a private network address. Namecheap sees this server’s public IPv4 address — use “Detect” or ask your host for the server’s outbound IP.');

  const environment = input.environment ?? existing?.environment ?? 'production';
  if (!IntegrationConnection.ENVIRONMENTS.includes(environment)) throw invalid('Environment must be production or sandbox.');

  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey && !API_KEY_PATTERN.test(apiKey)) throw invalid('That doesn’t look like a Namecheap API key (letters and numbers, up to 50 characters).');
  if (!apiKey && !existing?.credentialsCiphertext) throw invalid('Paste the API key from Namecheap (Profile → Tools → Namecheap API Access).');

  return {
    apiUser, userName, clientIp, environment, apiKey,
  };
}

// ─── Actions ───────────────────────────────────────────────────────────

async function getStatus(context) {
  const agencyOrganizationId = access.agencyIdFor(context);
  return toStatusDto(await getConnection(agencyOrganizationId));
}

async function runTest(connection) {
  const now = new Date();
  try {
    const reader = readerFor(connection);
    const { totalDomains } = await reader.testConnection();
    await connection.update({
      status: 'connected', lastTestedAt: now, lastVerifiedAt: now, lastErrorKind: null, lastErrorMessage: null, lastErrorProviderCode: null, lastErrorAt: null,
    });
    return { ok: true, totalDomains };
  } catch (err) {
    const fields = errorFields(err, now);
    await connection.update({ status: 'error', lastTestedAt: now, ...fields });
    return {
      ok: false,
      error: {
        kind: fields.lastErrorKind, message: fields.lastErrorMessage, providerCode: fields.lastErrorProviderCode,
      },
    };
  }
}

/** Saves (or replaces) the credentials, then proves them with one real call. */
async function saveCredentials(context, input, actorUserId) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const existing = await getConnection(agencyOrganizationId);
  const fields = normalizeCredentialsInput(input || {}, existing);
  const now = new Date();

  const credentialsCiphertext = fields.apiKey
    ? encryptJson({ apiKey: fields.apiKey }, secretContext({ agencyOrganizationId }))
    : existing.credentialsCiphertext;

  const values = {
    apiUser: fields.apiUser,
    accountUserName: fields.userName,
    clientIp: fields.clientIp,
    environment: fields.environment,
    credentialsCiphertext,
    credentialsUpdatedAt: now,
    credentialsUpdatedByUserId: actorUserId,
    status: 'unverified',
    lastErrorKind: null,
    lastErrorMessage: null,
    lastErrorProviderCode: null,
    lastErrorAt: null,
  };
  const connection = existing
    ? await existing.update(values)
    : await IntegrationConnection.create({ agencyOrganizationId, provider: PROVIDER, ...values });

  const test = await runTest(connection);
  return { status: toStatusDto(connection), test };
}

async function testConnection(context) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const connection = await getConnection(agencyOrganizationId);
  if (!connection?.credentialsCiphertext) throw invalid('Save your Namecheap credentials first.', 409);
  const test = await runTest(connection);
  return { status: toStatusDto(connection), test };
}

/**
 * Removes the stored key. Synced domain details stay (labelled as last
 * known), and every manual entry, link and override is untouched.
 */
async function disconnect(context) {
  const agencyOrganizationId = access.agencyIdFor(context);
  const connection = await getConnection(agencyOrganizationId);
  if (!connection) return toStatusDto(null);
  await connection.update({
    credentialsCiphertext: null,
    status: 'not_configured',
    syncLockedUntil: null,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastErrorProviderCode: null,
    lastErrorAt: null,
  });
  return toStatusDto(connection);
}

/**
 * Asks a public "what is my IP" service which IPv4 address this server's
 * outbound traffic uses — the address Namecheap will see and must be
 * whitelisted. Only runs when an admin clicks Detect.
 */
function detectPublicIpv4() {
  return new Promise((resolve, reject) => {
    const request = https.get('https://api.ipify.org?format=json', { family: 4, timeout: 6000 }, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1000) request.destroy();
      });
      response.on('end', () => {
        try {
          const { ip } = JSON.parse(body);
          if (net.isIPv4(ip)) resolve(ip);
          else reject(invalid('Could not detect a public IPv4 address.', 502));
        } catch {
          reject(invalid('Could not detect a public IPv4 address.', 502));
        }
      });
    });
    request.on('timeout', () => request.destroy(invalid('Timed out detecting the public IP address.', 504)));
    request.on('error', (err) => reject(err.statusCode ? err : invalid('Could not reach the IP detection service.', 502)));
  });
}

async function detectIp(context) {
  access.agencyIdFor(context);
  const ip = await detectPublicIpv4();
  return { ip, source: 'api.ipify.org (asked from this server over IPv4)' };
}

module.exports = {
  PROVIDER,
  AUTH_ERROR_KINDS,
  SYNC_LOCK_MS,
  getConnection,
  readerFor,
  accountKeyFor,
  errorFields,
  isSyncing,
  toStatusDto,
  getStatus,
  saveCredentials,
  testConnection,
  disconnect,
  detectIp,
  setReaderFactoryForTests,
};

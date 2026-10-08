'use strict';

const { parse: parseDomain } = require('tldts');
const { env } = require('../../core/config/env');
const { getStripeAdapter } = require('../../core/integrations/stripe/stripeAdapter');
const { sensitiveDataProblem } = require('../clients/sensitiveData');

function invalid(message, statusCode = 422, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

const POSTGRES_UNIQUE_VIOLATION = '23505';
function isUniqueViolation(err) {
  return err.name === 'SequelizeUniqueConstraintError' || err.parent?.code === POSTGRES_UNIQUE_VIOLATION;
}

/** Drops an extension ("x123", "ext 123") — it isn't part of the dialable number. */
function withoutExtension(phone) {
  return String(phone || '').replace(/\s*(?:x|ext\.?)\s*\d*\s*$/i, '');
}

/** Last ten digits — good enough to match North American numbers written differently. */
function phoneKey(phone) {
  const digits = withoutExtension(phone).replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** E.164 for sending texts/calls; assumes +1 for bare 10-digit numbers. */
function toE164(phone) {
  const raw = withoutExtension(phone).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function isEmail(value) {
  const text = String(value || '');
  if (!text || text.length > 254) return false;
  const at = text.indexOf('@');
  if (at < 1 || at !== text.lastIndexOf('@') || /\s/.test(text)) return false;
  const domain = text.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

function registrableDomain(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  const withoutEmail = text.includes('@') && !text.includes('/') ? text.split('@').pop() : text;
  const parsed = parseDomain(withoutEmail);
  return parsed.domain || null;
}

/** "Joe's Plumbing, LLC" and "joes plumbing" compare equal; very short names never match. */
function nameKey(name) {
  const cleaned = String(name || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|llc|inc|co|corp|corporation|company|ltd|pllc|pc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 4 ? cleaned : null;
}

const FREE_EMAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'live.com', 'msn.com', 'comcast.net', 'me.com']);

// Beyond the client hub's own password/card checks (sensitiveData.js),
// sales notes also reject pasted API keys and private keys.
const SECRET_PATTERNS = [
  /\b(api[\s_-]?key|secret|access[\s_-]?token|auth[\s_-]?token)\b\s*[:=]\s*\S{6,}/i,
  /\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/,
  /\bwhsec_[A-Za-z0-9]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/**
 * Notes and handoff fields must never hold passwords, API secrets or card
 * numbers (ADR 0011). Record whether access exists, not the access itself.
 */
function assertNoSecrets(text, label = 'This field') {
  if (!text) return;
  const value = String(text);
  const problem = sensitiveDataProblem(value);
  if (problem) throw invalid(`${label}: ${problem}`);
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    throw invalid(`${label}: API keys and secrets can’t be stored here. Record only who has access (for example “Client has registrar access”).`);
  }
}

function stripeMode() {
  return getStripeAdapter().mode;
}

function formatMoney(cents, currency = 'usd') {
  if (cents === null || cents === undefined) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function context(req) {
  return {
    agencyId: req.context.organization.id,
    agencyName: req.context.organization.name,
    userId: req.user.id,
    user: req.user,
    can: (key) => req.context.permissionKeys.has(key),
    // The request's own authorization context, for reusing client-hub services.
    authContext: req.context,
    // Workspace timezone (ADR 0012); null means "use the viewer's browser offset".
    timezone: req.context.organization.settings?.timezone || null,
    req,
  };
}

/** A minimal employee context for system work (webhooks) that reuses client-hub services. */
function systemAuthContext(agencyOrganizationId) {
  return {
    organization: { id: agencyOrganizationId },
    membership: { membershipType: 'employee' },
    permissionKeys: new Set(['projects.manage']),
  };
}

function appUrl(path) {
  return `${env.APP_BASE_URL.replace(/\/$/, '')}${path}`;
}

module.exports = {
  invalid,
  isUniqueViolation,
  phoneKey,
  toE164,
  registrableDomain,
  nameKey,
  isEmail,
  FREE_EMAIL_DOMAINS,
  assertNoSecrets,
  stripeMode,
  formatMoney,
  context,
  systemAuthContext,
  appUrl,
};

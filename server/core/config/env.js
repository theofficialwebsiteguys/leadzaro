'use strict';

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const KNOWN_INSECURE_DEFAULTS = new Set([
  'dev_secret_replace_in_production',
  'replace_with_a_long_random_secret_at_least_64_chars',
  '',
]);

function defaultStorageProvider() {
  if (IS_PRODUCTION) return 'disabled';
  if (NODE_ENV === 'test') return 'mock';
  return 'local';
}

const KNOWN_PLACEHOLDER_VALUES = new Set([
  'your_google_places_api_key_here',
  'sk_test_placeholder',
  'whsec_placeholder',
]);

/**
 * Each check appends to `errors`/`warnings` rather than throwing
 * directly — kept as small, independent functions (one per concern) so
 * this file's overall cognitive complexity doesn't keep growing every
 * time a new external-service provider is added (Phase 4 added two;
 * Phases 5-8 will add several more each).
 */
function checkCoreSecrets(errors, warnings) {
  const jwtSecret = process.env.JWT_SECRET || '';
  if (KNOWN_INSECURE_DEFAULTS.has(jwtSecret) || jwtSecret.length < 32) {
    const msg = 'JWT_SECRET is missing, too short, or a known development default.';
    (IS_PRODUCTION ? errors : warnings).push(msg);
  }

  // Hosted Postgres (Heroku) provides a single DATABASE_URL instead.
  if (process.env.DATABASE_URL && NODE_ENV !== 'test') return;

  if (!process.env.DB_PASS || process.env.DB_PASS === 'leadzaro_pass') {
    const msg = 'DB_PASS is missing or the known local-development default.';
    (IS_PRODUCTION ? errors : warnings).push(msg);
  }

  if (!process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_HOST) {
    errors.push('DB_NAME, DB_USER, and DB_HOST are all required (or DATABASE_URL on hosted Postgres).');
  }
}

/**
 * INTEGRATION_SECRETS_KEY encrypts third-party credentials an admin saves
 * in the app (e.g. the Namecheap API key). It is optional — nothing
 * depends on an integration being connected — but when set it must be a
 * real 32-byte key, and production cannot store credentials without it.
 */
function checkIntegrationSecretsKey(errors, warnings) {
  const raw = process.env.INTEGRATION_SECRETS_KEY || '';
  if (!raw) {
    if (IS_PRODUCTION) warnings.push('INTEGRATION_SECRETS_KEY is not set; integration credentials (e.g. Namecheap) cannot be saved until it is.');
    return;
  }
  const decoded = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    (IS_PRODUCTION ? errors : warnings).push('INTEGRATION_SECRETS_KEY must be 32 random bytes, base64- or hex-encoded (e.g. `openssl rand -base64 32`).');
  }
}

function checkProductionHardening(errors, warnings) {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY || '';
  if (IS_PRODUCTION && (KNOWN_PLACEHOLDER_VALUES.has(googleKey) || !googleKey)) {
    warnings.push('GOOGLE_PLACES_API_KEY is not configured; lead search will fall back to demo data.');
  }

  if (IS_PRODUCTION && (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN.includes('localhost'))) {
    errors.push('CORS_ORIGIN must be set to the production origin (not localhost) in production.');
  }

  if (IS_PRODUCTION && process.env.SESSION_COOKIE_SECURE === 'false') {
    errors.push('SESSION_COOKIE_SECURE must not be disabled in production.');
  }
}

/**
 * A live-mode external-service provider whose required credential env
 * vars are missing/placeholder is a production-blocking misconfiguration
 * (never silently fall back to mock/disabled once an operator has
 * explicitly asked for 'live'). One call per provider, added here as
 * each phase wires one up — keeps `validateEnv` itself a flat, short list
 * instead of one branch per provider growing its complexity indefinitely.
 */
function checkLiveProviderCredentials(errors, {
  providerEnvVar, defaultProvider, requiredVars,
}) {
  const provider = process.env[providerEnvVar] || defaultProvider;
  if (provider !== 'live') return;
  const missing = requiredVars.filter((name) => {
    const value = process.env[name] || '';
    return !value || KNOWN_PLACEHOLDER_VALUES.has(value);
  });
  if (missing.length) {
    errors.push(`${providerEnvVar}=live but ${missing.join('/')} ${missing.length > 1 ? 'are' : 'is'} missing or still a placeholder value.`);
  }
}

/**
 * Fails fast in production when required configuration is missing or is
 * still a known development/placeholder value. In non-production
 * environments this only warns, so local/dev setup is never blocked.
 */
function validateEnv() {
  const errors = [];
  const warnings = [];

  checkCoreSecrets(errors, warnings);
  checkIntegrationSecretsKey(errors, warnings);
  checkProductionHardening(errors, warnings);

  const defaultProvider = IS_PRODUCTION ? 'disabled' : 'mock';
  checkLiveProviderCredentials(errors, { providerEnvVar: 'STRIPE_PROVIDER', defaultProvider, requiredVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] });
  checkLiveProviderCredentials(errors, { providerEnvVar: 'GOOGLE_CALENDAR_PROVIDER', defaultProvider, requiredVars: ['GOOGLE_CALENDAR_CREDENTIALS_JSON'] });
  checkLiveProviderCredentials(errors, { providerEnvVar: 'STORAGE_PROVIDER', defaultProvider, requiredVars: ['GCS_CREDENTIALS_JSON', 'GCS_BUCKET_NAME'] });
  checkLiveProviderCredentials(errors, { providerEnvVar: 'GITHUB_PROVIDER', defaultProvider, requiredVars: ['GITHUB_APP_CREDENTIALS_JSON', 'GITHUB_ORG'] });
  checkLiveProviderCredentials(errors, { providerEnvVar: 'NAMECHEAP_PROVIDER', defaultProvider, requiredVars: ['NAMECHEAP_API_CREDENTIALS_JSON'] });
  checkLiveProviderCredentials(errors, { providerEnvVar: 'CPANEL_PROVIDER', defaultProvider, requiredVars: ['CPANEL_API_CREDENTIALS_JSON'] });
  checkLiveProviderCredentials(errors, { providerEnvVar: 'SEO_AUDIT_PROVIDER', defaultProvider, requiredVars: ['SEO_AUDIT_API_CREDENTIALS_JSON'] });

  if (warnings.length) {
    for (const w of warnings) {
      // eslint-disable-next-line no-console
      console.warn(`[config] WARNING: ${w}`);
    }
  }

  if (errors.length) {
    for (const e of errors) {
      // eslint-disable-next-line no-console
      console.error(`[config] FATAL: ${e}`);
    }
    if (IS_PRODUCTION) {
      throw new Error(`Invalid production configuration (${errors.length} issue(s)). Refusing to start.`);
    }
  }
}

const env = {
  NODE_ENV,
  IS_PRODUCTION,
  IS_TEST: NODE_ENV === 'test',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:4200',
  APP_BASE_URL: process.env.APP_BASE_URL || process.env.CORS_ORIGIN || 'http://localhost:4200',

  ACCESS_TOKEN_SECRET: process.env.JWT_SECRET || 'dev_secret_replace_in_production',
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '15m',
  REFRESH_TOKEN_TTL_DAYS: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 30,
  IMPERSONATION_TOKEN_TTL_MINUTES: parseInt(process.env.IMPERSONATION_TOKEN_TTL_MINUTES, 10) || 30,

  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME || 'lz_session',
  SESSION_COOKIE_SECURE: IS_PRODUCTION ? process.env.SESSION_COOKIE_SECURE !== 'false' : process.env.SESSION_COOKIE_SECURE === 'true',

  FEATURE_PUBLIC_REGISTRATION: process.env.FEATURE_PUBLIC_REGISTRATION === 'true',

  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'console',
  EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS || 'no-reply@thewebsiteguys.local',

  INVITATION_TOKEN_TTL_HOURS: parseInt(process.env.INVITATION_TOKEN_TTL_HOURS, 10) || 168,
  PASSWORD_RESET_TOKEN_TTL_MINUTES: parseInt(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES, 10) || 60,
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: parseInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS, 10) || 48,

  // No real enrichment provider exists yet (see docs/leadzaro/ADRs).
  // Defaults to a clearly-labeled mock in development (useful for
  // building/demoing the feature) but disabled in production unless an
  // operator explicitly opts in — showing fabricated business data to a
  // real sales team as if it came from a real provider would be worse
  // than showing nothing.
  ENRICHMENT_PROVIDER: process.env.ENRICHMENT_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock'),

  // No real Stripe credentials exist yet. Same reasoning as
  // ENRICHMENT_PROVIDER: mock in dev (a full internal workflow to build
  // and test against) but disabled in production unless explicitly
  // opted into — never process a real payment against a placeholder
  // key, and never silently pretend a payment succeeded.
  STRIPE_PROVIDER: process.env.STRIPE_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock'),
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  // Checkout/Payment Link behaviour that must match the Stripe account
  // (ADR 0011): only turn tax on once Stripe Tax is set up in the account.
  STRIPE_AUTOMATIC_TAX: process.env.STRIPE_AUTOMATIC_TAX === 'true',
  STRIPE_ALLOW_PROMOTION_CODES: process.env.STRIPE_ALLOW_PROMOTION_CODES === 'true',
  STRIPE_DEFAULT_CURRENCY: (process.env.STRIPE_DEFAULT_CURRENCY || 'usd').toLowerCase(),
  STRIPE_CHECKOUT_EXPIRY_HOURS: Math.min(24, Math.max(1, parseInt(process.env.STRIPE_CHECKOUT_EXPIRY_HOURS, 10) || 24)),

  // Outreach channels (ADR 0011). Email sends through SMTP when
  // EMAIL_PROVIDER=smtp; texts and click-to-call through Twilio when its
  // three values are set. Neither is simulated: an unconfigured channel is
  // shown as not connected and outreach is logged by hand instead.
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SALES_EMAIL_FROM: process.env.SALES_EMAIL_FROM || '',
  // Safe test path for outreach (ADR 0014): when set, every sales email is
  // delivered to this address instead of the lead, with the intended
  // recipient shown in the subject.
  SALES_EMAIL_TEST_REDIRECT: process.env.SALES_EMAIL_TEST_REDIRECT || '',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER || '',
  TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
  // Public https base URL of this API, used for Twilio delivery/reply
  // callbacks. Without it texts still send but delivery states and replies
  // cannot arrive.
  PUBLIC_API_BASE_URL: (process.env.PUBLIC_API_BASE_URL || '').replace(/\/$/, ''),
  // Leadzaro is internal-only: paying clients are not invited to log in
  // unless this is explicitly turned back on.
  CLIENT_PORTAL_AUTO_INVITE: process.env.CLIENT_PORTAL_AUTO_INVITE === 'true',

  // No real Google Calendar/Cloud Storage credentials exist yet. Same
  // reasoning as ENRICHMENT_PROVIDER/STRIPE_PROVIDER: mock in dev, but
  // disabled in production unless explicitly opted into.
  GOOGLE_CALENDAR_PROVIDER: process.env.GOOGLE_CALENDAR_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock'),
  GOOGLE_CALENDAR_CREDENTIALS_JSON: process.env.GOOGLE_CALENDAR_CREDENTIALS_JSON || '',
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || '',

  // Development defaults to 'local' (real files on disk, served through
  // short-lived signed links) so uploads can actually be previewed and
  // downloaded while building; tests keep the in-memory 'mock';
  // production stays disabled unless 'live' (GCS) is configured.
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || defaultStorageProvider(),
  LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR || 'server/.dev-storage',
  GCS_CREDENTIALS_JSON: process.env.GCS_CREDENTIALS_JSON || '',
  GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME || '',

  // No real GitHub App credentials exist yet (Phase 6 — website
  // repository creation, branches, previews). Same reasoning as every
  // other provider above: mock in dev (a full in-memory repo/branch/PR
  // lifecycle to build and test the promote-to-development workflow
  // against), disabled in production unless explicitly opted into —
  // never silently pretend a repository/deployment was created.
  GITHUB_PROVIDER: process.env.GITHUB_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock'),
  GITHUB_APP_CREDENTIALS_JSON: process.env.GITHUB_APP_CREDENTIALS_JSON || '',
  GITHUB_ORG: process.env.GITHUB_ORG || '',

  // No real Namecheap API credentials exist yet (Phase 7 — domain
  // registration, DNS records, renewal, transfer). Same reasoning as
  // every other provider above: mock in dev (a full in-memory domain
  // registry to build and test the domain-management workflow against),
  // disabled in production unless explicitly opted into — never
  // actually register a domain or change live DNS from this codebase
  // (CLAUDE.md rule 8).
  NAMECHEAP_PROVIDER: process.env.NAMECHEAP_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock'),
  NAMECHEAP_API_CREDENTIALS_JSON: process.env.NAMECHEAP_API_CREDENTIALS_JSON || '',

  // No real cPanel API credentials exist yet (Phase 7 — shared-hosting
  // upload, document-root mapping, backup/restore, health checks). Same
  // reasoning as every other provider above: mock in dev (a full
  // in-memory hosting-account simulation to build and test the
  // production deploy/rollback pipeline against), disabled in
  // production unless explicitly opted into — never actually upload to
  // a real cPanel account from this codebase (CLAUDE.md rule 8).
  CPANEL_PROVIDER: process.env.CPANEL_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock'),
  CPANEL_API_CREDENTIALS_JSON: process.env.CPANEL_API_CREDENTIALS_JSON || '',

  // No real SEO audit provider (broken-link/performance checking)
  // exists yet (Phase 8 — heading/alt-text checks run structurally
  // against the schema directly, no adapter needed; this covers only
  // the two checks that genuinely require external capability). Same
  // reasoning as every other provider above.
  SEO_AUDIT_PROVIDER: process.env.SEO_AUDIT_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock'),
  SEO_AUDIT_API_CREDENTIALS_JSON: process.env.SEO_AUDIT_API_CREDENTIALS_JSON || '',

  // Read-only registrar sync (ADR 0009) — unrelated to NAMECHEAP_PROVIDER
  // above, which belongs to the hidden website builder. There is no mock
  // mode: the connection is either a real, verified Namecheap account an
  // admin entered in Settings, or it is not connected. Credentials are
  // stored encrypted with this key (see core/security/secretBox.js).
  INTEGRATION_SECRETS_KEY: process.env.INTEGRATION_SECRETS_KEY || '',

  // The in-process daily scheduler (core/jobs/scheduler.js). Off in tests;
  // a deployment whose API process does not stay running can instead run
  // `npm run jobs:run` from an external scheduler.
  JOBS_ENABLED: process.env.JOBS_ENABLED ? process.env.JOBS_ENABLED === 'true' : NODE_ENV !== 'test',
};

module.exports = { env, validateEnv };

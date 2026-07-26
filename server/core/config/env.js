'use strict';

require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

const KNOWN_INSECURE_DEFAULTS = new Set([
  'dev_secret_replace_in_production',
  'replace_with_a_long_random_secret_at_least_64_chars',
  '',
]);

const KNOWN_PLACEHOLDER_VALUES = new Set([
  'your_google_places_api_key_here',
  'sk_test_placeholder',
  'whsec_placeholder',
]);

/**
 * Fails fast in production when required configuration is missing or is
 * still a known development/placeholder value. In non-production
 * environments this only warns, so local/dev setup is never blocked.
 */
function validateEnv() {
  const errors = [];
  const warnings = [];

  const jwtSecret = process.env.JWT_SECRET || '';
  if (KNOWN_INSECURE_DEFAULTS.has(jwtSecret) || jwtSecret.length < 32) {
    const msg = 'JWT_SECRET is missing, too short, or a known development default.';
    IS_PRODUCTION ? errors.push(msg) : warnings.push(msg);
  }

  if (!process.env.DB_PASS || process.env.DB_PASS === 'leadzaro_pass') {
    const msg = 'DB_PASS is missing or the known local-development default.';
    IS_PRODUCTION ? errors.push(msg) : warnings.push(msg);
  }

  if (!process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_HOST) {
    errors.push('DB_NAME, DB_USER, and DB_HOST are all required.');
  }

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

  const stripeProvider = process.env.STRIPE_PROVIDER || (IS_PRODUCTION ? 'disabled' : 'mock');
  if (stripeProvider === 'live') {
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (KNOWN_PLACEHOLDER_VALUES.has(stripeKey) || !stripeKey || KNOWN_PLACEHOLDER_VALUES.has(webhookSecret) || !webhookSecret) {
      errors.push('STRIPE_PROVIDER=live but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are missing or still placeholder values.');
    }
  }

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
};

module.exports = { env, validateEnv };

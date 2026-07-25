'use strict';

const { env } = require('../config/env');

/**
 * Email provider interface. Phase 1 ships only a console/dev
 * implementation (no real SMTP/API credentials exist yet) — the adapter
 * boundary is what lets a real provider (SES, Postmark, SendGrid, ...)
 * be dropped in later without touching call sites. `send` never throws
 * on delivery failure from the caller's perspective; it returns a
 * `delivered` flag so the notification is still recorded even if email
 * transport is unavailable.
 */
class EmailAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async send({ to, subject, text }) {
    throw new Error('EmailAdapter.send must be implemented by a subclass');
  }
}

class ConsoleEmailAdapter extends EmailAdapter {
  async send({ to, subject, text }) {
    // eslint-disable-next-line no-console
    console.log(`\n[email:console] to=${to}\nsubject=${subject}\n${text}\n`);
    return { delivered: false, provider: 'console' };
  }
}

class NoopEmailAdapter extends EmailAdapter {
  // eslint-disable-next-line class-methods-use-this
  async send() {
    return { delivered: false, provider: 'none' };
  }
}

let cachedAdapter = null;

function getEmailAdapter() {
  if (cachedAdapter) return cachedAdapter;

  // The console adapter logs invitation/password-reset links — including
  // the raw secret token — to stdout. That's a deliberate, useful dev-mode
  // substitute for real email delivery, but production server logs are
  // often more broadly accessible (log aggregators, ops tooling) than the
  // app itself, so it must never be the silent default there. No real
  // provider exists yet (see EMAIL_PROVIDER in .env.example), so
  // production falls back to Noop — notifications simply don't send —
  // until a real provider is wired up, rather than leaking tokens.
  if (env.IS_PRODUCTION && env.EMAIL_PROVIDER !== 'none') {
    // eslint-disable-next-line no-console
    console.warn('[config] WARNING: no real EMAIL_PROVIDER is configured in production; emails will not be sent (Noop adapter). Set EMAIL_PROVIDER=none explicitly once this is expected.');
    cachedAdapter = new NoopEmailAdapter();
    return cachedAdapter;
  }

  cachedAdapter = env.EMAIL_PROVIDER === 'none' ? new NoopEmailAdapter() : new ConsoleEmailAdapter();
  return cachedAdapter;
}

module.exports = { getEmailAdapter, EmailAdapter, ConsoleEmailAdapter, NoopEmailAdapter };

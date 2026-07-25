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
  cachedAdapter = env.EMAIL_PROVIDER === 'none' ? new NoopEmailAdapter() : new ConsoleEmailAdapter();
  return cachedAdapter;
}

module.exports = { getEmailAdapter, EmailAdapter, ConsoleEmailAdapter, NoopEmailAdapter };

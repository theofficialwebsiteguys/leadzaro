'use strict';

const crypto = require('node:crypto');
const { env } = require('../../config/env');

/**
 * Google Calendar provider interface (Phase 4 meetings — master
 * architecture § 24 integration priority #6). No real Google OAuth
 * credentials exist in this environment (see .env.example) — the
 * adapter boundary mirrors StripeAdapter/EmailAdapter/EnrichmentAdapter
 * exactly. A meeting can still be requested/confirmed entirely within
 * Leadzaro without a real calendar event (see `DisabledGoogleCalendarAdapter`
 * — a "not configured" result, not a thrown error, since the internal
 * meeting workflow does not depend on Calendar being wired up).
 */
class GoogleCalendarAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createEvent({
    summary, description, attendeeEmails, startTime, endTime,
  }) {
    throw new Error('GoogleCalendarAdapter.createEvent must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async cancelEvent(eventId) {
    throw new Error('GoogleCalendarAdapter.cancelEvent must be implemented by a subclass');
  }
}

/**
 * Real Google Calendar API-backed implementation. Untestable in this
 * environment (no real OAuth credentials), but structurally complete —
 * `googleapis` is lazily required only when this class is actually
 * instantiated, matching LiveStripeAdapter's pattern, so the dependency
 * never has to load unless GOOGLE_CALENDAR_PROVIDER=live is configured.
 */
class LiveGoogleCalendarAdapter extends GoogleCalendarAdapter {
  constructor(credentialsJson, calendarId) {
    super();
    // eslint-disable-next-line global-require
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentialsJson),
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
    });
    this.calendar = google.calendar({ version: 'v3', auth });
    this.calendarId = calendarId || 'primary';
  }

  async createEvent({
    summary, description, attendeeEmails, startTime, endTime,
  }) {
    const { data } = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary,
        description,
        start: { dateTime: startTime },
        end: { dateTime: endTime },
        attendees: (attendeeEmails || []).map((email) => ({ email })),
      },
    });
    return { status: 'created', provider: 'google', eventId: data.id, htmlLink: data.htmlLink };
  }

  async cancelEvent(eventId) {
    await this.calendar.events.delete({ calendarId: this.calendarId, eventId });
    return { status: 'cancelled', provider: 'google' };
  }
}

/**
 * Simulates event creation without any real network call. Every id it
 * returns is clearly prefixed `mock_` so it can never be confused with a
 * real Google Calendar event id in logs or the database.
 */
class MockGoogleCalendarAdapter extends GoogleCalendarAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createEvent({ summary }) {
    const eventId = `mock_gcal_evt_${crypto.randomUUID()}`;
    return {
      status: 'created',
      provider: 'mock',
      eventId,
      htmlLink: `https://mock.calendar.test/event/${eventId}`,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async cancelEvent() {
    return { status: 'cancelled', provider: 'mock' };
  }
}

class DisabledGoogleCalendarAdapter extends GoogleCalendarAdapter {
  // eslint-disable-next-line class-methods-use-this
  async createEvent() {
    return {
      status: 'not_configured', provider: 'none', eventId: null, htmlLink: null,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  async cancelEvent() {
    return { status: 'not_configured', provider: 'none' };
  }
}

let cachedAdapter = null;

function getGoogleCalendarAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.GOOGLE_CALENDAR_PROVIDER === 'live') {
    cachedAdapter = new LiveGoogleCalendarAdapter(env.GOOGLE_CALENDAR_CREDENTIALS_JSON, env.GOOGLE_CALENDAR_ID);
    return cachedAdapter;
  }

  if (env.GOOGLE_CALENDAR_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: GOOGLE_CALENDAR_PROVIDER=mock is set in production — no real calendar events will be created.');
    }
    cachedAdapter = new MockGoogleCalendarAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledGoogleCalendarAdapter();
  return cachedAdapter;
}

module.exports = {
  getGoogleCalendarAdapter, GoogleCalendarAdapter, LiveGoogleCalendarAdapter, MockGoogleCalendarAdapter, DisabledGoogleCalendarAdapter,
};

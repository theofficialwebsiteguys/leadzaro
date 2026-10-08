'use strict';

/**
 * Workspace timezone (ADR 0012). When the workspace has a timezone set,
 * every "today", "overdue" and report date boundary is computed in it, so
 * everyone on the team sees the same day. Without one, the viewer's own
 * browser offset is used (the previous behaviour).
 */

function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Minutes behind UTC, in the same sign convention as Date#getTimezoneOffset. */
function offsetMinutes(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((wholeSeconds - asUtc) / 60000);
}

/** The offset to use for a request: the workspace timezone when set, else the client's. */
function effectiveOffset(timeZone, clientOffset) {
  if (isValidTimeZone(timeZone)) return offsetMinutes(timeZone);
  const n = Number(clientOffset);
  return Number.isFinite(n) ? Math.max(-840, Math.min(840, n)) : 0;
}

/** Start of a calendar date (YYYY-MM-DD) in the given offset, as a UTC instant. */
function startOfLocalDate(isoDate, offset) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + offset * 60000);
}

module.exports = {
  isValidTimeZone, offsetMinutes, effectiveOffset, startOfLocalDate,
};

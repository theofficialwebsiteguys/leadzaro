'use strict';

const crypto = require('node:crypto');
const { ClientProfile, Project } = require('../../models');
const { sensitiveDataProblem } = require('./sensitiveData');

/**
 * Normalizes and validates client-hub input. Every field is optional —
 * forms send only what they own, and future automations (onboarding
 * forms, a Stripe sync) can send partial updates the same way. Blank
 * strings become NULL so "not provided" is always NULL, never ''.
 */

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const TEXT_LIMITS = {
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  state: 100,
  postalCode: 20,
  country: 100,
};
const LONG_TEXT_FIELDS = ['description', 'internalNotes', 'accessNotes', 'billingNotes', 'internalCostNotes'];
const CENTS_FIELDS = ['setupPriceCents', 'recurringPriceCents', 'internalMonthlyCostCents'];
const LINK_FIELDS = ['adminLinks', 'billingLinks'];
const FILE_FIELDS = ['logoFileId', 'featuredImageFileId'];

function blank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function text(field, value, max) {
  if (blank(value)) return null;
  if (typeof value !== 'string') throw invalid(`${field} must be text`);
  const trimmed = value.trim();
  if (max && trimmed.length > max) throw invalid(`${field} must be ${max} characters or fewer`);
  return trimmed;
}

function longText(field, value) {
  const normalized = text(field, value, 10000);
  const problem = sensitiveDataProblem(normalized);
  if (problem) throw invalid(problem);
  return normalized;
}

/** Accepts "havenfitclub.com" as well as full URLs; only http(s). */
function url(field, value) {
  if (blank(value)) return null;
  if (typeof value !== 'string') throw invalid(`${field} must be a web address`);
  let candidate = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw invalid(`${field} is not a valid web address`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) {
    throw invalid(`${field} is not a valid web address`);
  }
  if (candidate.length > 500) throw invalid(`${field} is too long`);
  return candidate;
}

function cents(field, value) {
  if (blank(value)) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100000000) throw invalid(`${field} must be a whole number of cents, 0 or more`);
  return number;
}

function date(field, value) {
  if (blank(value)) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw invalid(`${field} must be a date (YYYY-MM-DD)`);
  }
  return value;
}

function oneOf(field, value, allowed) {
  if (blank(value)) return null;
  if (!allowed.includes(value)) throw invalid(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

/** [{ label, url }] — empty rows dropped, max 20. */
function links(field, value) {
  if (blank(value)) return [];
  if (!Array.isArray(value)) throw invalid(`${field} must be a list of links`);
  const cleaned = value
    .filter((entry) => entry && !(blank(entry.label) && blank(entry.url)))
    .map((entry) => ({
      label: text(`${field} label`, entry.label, 80) || null,
      url: url(`${field} link`, entry.url),
    }));
  if (cleaned.some((entry) => !entry.url)) throw invalid(`Every ${field} entry needs a web address`);
  if (cleaned.length > 20) throw invalid(`${field} can hold at most 20 links`);
  return cleaned;
}

/**
 * Picks and validates any ClientProfile fields present in `input`.
 * File-reference fields are returned as-is here; the caller verifies they
 * point at an image that belongs to this client.
 */
function normalizeProfileInput(input) {
  const editable = new Set(Object.values(ClientProfile.EDITABLE_FIELDS).flat());
  const out = {};
  for (const [field, value] of Object.entries(input)) {
    if (!editable.has(field)) continue;
    if (TEXT_LIMITS[field] !== undefined) {
      out[field] = text(field, value, TEXT_LIMITS[field]);
    } else if (LONG_TEXT_FIELDS.includes(field)) {
      out[field] = longText(field, value);
    } else if (CENTS_FIELDS.includes(field)) {
      out[field] = cents(field, value);
    } else if (LINK_FIELDS.includes(field)) {
      out[field] = links(field, value);
    } else if (FILE_FIELDS.includes(field)) {
      out[field] = blank(value) ? null : String(value);
    } else if (field === 'websiteUrl') {
      out[field] = url('Website', value);
    } else if (field === 'billingFrequency') {
      out[field] = oneOf(field, value, ClientProfile.BILLING_FREQUENCIES);
    } else if (field === 'paymentStatus') {
      out[field] = oneOf(field, value, ClientProfile.PAYMENT_STATUSES);
    } else if (field === 'accountManagerUserId') {
      // Checked against the team in the service.
      out[field] = blank(value) ? null : String(value);
    } else if (field === 'services') {
      out[field] = serviceList(value);
    } else if (field === 'scopeNotes') {
      out[field] = longText('Agreed scope', value);
    } else if (field === 'waitingOn') {
      out[field] = oneOf('Waiting on', value, ClientProfile.WAITING_ON);
    } else if (field === 'waitingOnNote' || field === 'nextActionNote' || field === 'endReason') {
      const note = text(field, value, 255);
      const problem = sensitiveDataProblem(note);
      if (problem) throw invalid(problem);
      out[field] = note;
    } else if (field === 'nextActionAt') {
      out[field] = dateTime('Next action date', value);
    } else if (field === 'clientSince' || field === 'clientEndedAt') {
      out[field] = date(field === 'clientSince' ? 'Client since' : 'Client ended', value);
    }
  }
  return out;
}

/** A short list of service names ("Website build", "Care plan"), max 20. */
function serviceList(value) {
  if (blank(value)) return [];
  if (!Array.isArray(value)) throw invalid('Services must be a list');
  const cleaned = [...new Set(value.map((item) => text('Service', item, 120)).filter(Boolean))];
  if (cleaned.length > 20) throw invalid('List at most 20 services');
  for (const item of cleaned) {
    const problem = sensitiveDataProblem(item);
    if (problem) throw invalid(problem);
  }
  return cleaned;
}

/**
 * An ISO date-time (or YYYY-MM-DD) within the next two years. A bare date
 * is stored at noon UTC so it reads as the same day in every US timezone.
 */
function dateTime(field, value) {
  if (blank(value)) return null;
  const textValue = String(value);
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(textValue) ? `${textValue}T12:00:00.000Z` : textValue);
  if (Number.isNaN(parsed.getTime())) throw invalid(`${field} must be a valid date`);
  if (parsed.getTime() > Date.now() + 2 * 366 * 86400000) throw invalid(`${field} must be within two years`);
  return parsed;
}

function clientName(value) {
  const name = text('Client name', value, 150);
  if (!name) throw invalid('Client name is required');
  return name;
}

/** [{ id, label, done }] — ids kept stable so edits/toggles don't reshuffle. */
function outstandingNeeds(value) {
  if (blank(value)) return [];
  if (!Array.isArray(value)) throw invalid('Still-needed items must be a list');
  const cleaned = value
    .filter((item) => item && !blank(item.label))
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.length <= 64 ? item.id : crypto.randomUUID(),
      label: text('Still-needed item', item.label, 200),
      done: Boolean(item.done),
    }));
  if (cleaned.length > 50) throw invalid('A project can list at most 50 still-needed items');
  return cleaned;
}

/** Picks and validates any descriptive Project fields present in `input`. */
function normalizeProjectInput(input, { requireName }) {
  const out = {};
  if (input.name !== undefined || requireName) {
    const name = text('Project name', input.name, 150);
    if (!name && requireName) throw invalid('Project name is required');
    out.name = name;
  }
  if (input.projectType !== undefined) out.projectType = oneOf('Project type', input.projectType, Project.PROJECT_TYPES);
  if (input.description !== undefined) out.description = longText('Description', input.description);
  if (input.liveUrl !== undefined) out.liveUrl = url('Live URL', input.liveUrl);
  if (input.previewUrl !== undefined) out.previewUrl = url('Preview URL', input.previewUrl);
  if (input.previewFileId !== undefined) out.previewFileId = blank(input.previewFileId) ? null : String(input.previewFileId);
  if (input.outstandingNeeds !== undefined) out.outstandingNeeds = outstandingNeeds(input.outstandingNeeds);
  return out;
}

module.exports = {
  invalid, normalizeProfileInput, normalizeProjectInput, clientName, longText, text, url, cents, date, oneOf, blank,
};

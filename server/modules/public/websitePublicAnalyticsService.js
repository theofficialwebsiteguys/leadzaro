'use strict';

const { WebsiteAnalyticsEvent } = require('../../models');
const { getLiveWebsiteForPublicSubmission } = require('../../core/authorization/clientVisibleModels');

function notFound() {
  const err = new Error('Not found');
  err.statusCode = 404;
  return err;
}

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Hybrid analytics — Leadzaro's own high-value-action recording
 * (current-phase-plan.md § 2d, architecture § 19). Same anonymous,
 * no-requester-context write path as websitePublicFormService (slice
 * 6), reusing the exact same getLiveWebsiteForPublicSubmission lookup
 * and the same generic-404 hardening (review finding #10).
 */
async function recordAnalyticsEvent({
  websiteId, eventType, path, sessionId, metadata,
}) {
  if (!WebsiteAnalyticsEvent.EVENT_TYPES.includes(eventType)) {
    throw invalid(`Unknown eventType: ${eventType}`);
  }

  const website = await getLiveWebsiteForPublicSubmission(websiteId);
  if (!website) throw notFound();

  await WebsiteAnalyticsEvent.create({
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    eventType,
    path: path || null,
    sessionId,
    metadata: metadata || {},
  });

  return { recorded: true };
}

module.exports = { recordAnalyticsEvent };

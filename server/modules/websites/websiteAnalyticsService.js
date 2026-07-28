'use strict';

const {
  listWebsiteAnalyticsEventsForRequester, getWebsiteAnalyticsSummaryForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('./websiteService');

const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Za-z0-9]+$/;

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function listEvents(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteAnalyticsEventsForRequester(context, { websiteId: website.id });
}

async function getSummary(context, projectId, { rangeDays } = {}) {
  const website = await getWebsite(context, projectId);
  return getWebsiteAnalyticsSummaryForRequester(context, website.id, { rangeDays });
}

/**
 * Guided Google Analytics connection (current-phase-plan.md § 2d) —
 * Leadzaro never provisions a GA account; this only stores a
 * measurement ID the agency/client already has, employee-settable.
 * The generator (generateWebsiteFiles) embeds it into the generated
 * leadzaro.config.json only when set.
 */
async function setGoogleAnalyticsMeasurementId({ context, projectId, measurementId }) {
  const website = await getWebsite(context, projectId);
  if (measurementId && !GA_MEASUREMENT_ID_PATTERN.test(measurementId)) {
    throw invalid('measurementId must look like a real GA4 measurement ID (e.g. G-XXXXXXXXXX)');
  }
  await website.update({ googleAnalyticsMeasurementId: measurementId || null });
  return website;
}

module.exports = { listEvents, getSummary, setGoogleAnalyticsMeasurementId };

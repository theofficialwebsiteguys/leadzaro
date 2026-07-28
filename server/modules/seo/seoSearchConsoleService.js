'use strict';

const { getWebsite } = require('../websites/websiteService');
const { assertSeoEntitlement } = require('./seoEntitlementService');

// Google Search Console properties are either a URL-prefix property
// (e.g. https://example.com/) or a domain property (sc-domain:example.com)
// — accept either shape. Leadzaro never provisions/authenticates a GSC
// property (current-phase-plan.md § 2e); this only stores a value the
// agency/client already verified themselves, mirroring
// googleAnalyticsMeasurementId's exact precedent from Phase 7.
const GSC_PROPERTY_PATTERN = /^(https?:\/\/[^\s]+|sc-domain:[^\s]+)$/;

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function setSearchConsoleProperty({ context, projectId, propertyUrl }) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);

  if (propertyUrl && !GSC_PROPERTY_PATTERN.test(propertyUrl)) {
    throw invalid('propertyUrl must look like a real Search Console property (e.g. https://example.com/ or sc-domain:example.com)');
  }

  await website.update({ googleSearchConsolePropertyUrl: propertyUrl || null });
  return website;
}

module.exports = { setSearchConsoleProperty };

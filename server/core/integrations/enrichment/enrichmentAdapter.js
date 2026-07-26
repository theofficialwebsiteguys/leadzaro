'use strict';

const { env } = require('../../config/env');

/**
 * Business-data enrichment provider interface. No real vendor is wired
 * up yet — this is the adapter boundary standing external-services rule
 * calls for (typed interface, mock/disabled modes, structured result,
 * never a silent failure) so a real provider (Clearbit, Hunter.io, ...)
 * can be dropped in later without touching call sites. `enrich` never
 * throws for a normal "no data"/"not configured" outcome — it returns a
 * structured result so the caller always knows what actually happened.
 */
class EnrichmentAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async enrich({
    businessName, website, phone, category,
  }) {
    throw new Error('EnrichmentAdapter.enrich must be implemented by a subclass');
  }
}

/**
 * Deterministic, clearly-labeled fake data derived from what's already
 * on file — useful for building/demoing the feature, never mistakable
 * for a real vendor response (every field it returns is a plausible-
 * looking guess, not a lookup).
 */
class MockEnrichmentAdapter extends EnrichmentAdapter {
  // eslint-disable-next-line class-methods-use-this
  async enrich({ businessName, category }) {
    const seed = (businessName || '').length;
    const employeeBands = ['1-10', '11-50', '51-200', '201-500'];
    return {
      status: 'success',
      provider: 'mock',
      data: {
        industry: category || 'Unknown',
        estimatedEmployeeCount: employeeBands[seed % employeeBands.length],
        socialProfiles: { facebook: null, instagram: null, linkedin: null },
        note: 'Mock data for demonstration only — no real enrichment provider is configured.',
      },
    };
  }
}

class DisabledEnrichmentAdapter extends EnrichmentAdapter {
  // eslint-disable-next-line class-methods-use-this
  async enrich() {
    return { status: 'not_configured', provider: 'none', data: null };
  }
}

let cachedAdapter = null;

function getEnrichmentAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.ENRICHMENT_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: ENRICHMENT_PROVIDER=mock is set in production — enrichment results will be fabricated demo data, not real business data.');
    }
    cachedAdapter = new MockEnrichmentAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledEnrichmentAdapter();
  return cachedAdapter;
}

module.exports = {
  getEnrichmentAdapter, EnrichmentAdapter, MockEnrichmentAdapter, DisabledEnrichmentAdapter,
};

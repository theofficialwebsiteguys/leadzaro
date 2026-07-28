'use strict';

const { env } = require('../../config/env');

/**
 * SEO audit provider interface (Phase 8 slice 5 — broken-link and
 * performance checks; current-phase-plan.md § 2c). No real external
 * credentials exist in this environment. Unlike structural checks
 * (heading/alt-text — run directly against the schema, no adapter
 * needed), these genuinely require external capability: a real HTTP
 * request per URL, a real Lighthouse-style performance run.
 *
 * Every check resolves to one of three outcomes, not two — 'ok',
 * 'broken', or 'inconclusive' (the adapter genuinely couldn't
 * determine an answer, e.g. a timeout) — so "couldn't check this"
 * surfaces as its own distinct finding rather than silently passing
 * as a false "ok" (architecture § 25's "no silent failures").
 */
class SeoAuditAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async checkLinks(urls) {
    throw new Error('SeoAuditAdapter.checkLinks must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async checkPerformance(url) {
    throw new Error('SeoAuditAdapter.checkPerformance must be implemented by a subclass');
  }
}

/**
 * Real HTTP/Lighthouse-backed implementation. Untestable in this
 * environment (no real outbound audit infrastructure configured) and
 * structurally complete but never invoked in this session.
 */
class LiveSeoAuditAdapter extends SeoAuditAdapter {
  constructor(credentialsJson) {
    super();
    this.credentials = credentialsJson ? JSON.parse(credentialsJson) : null;
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async checkLinks(urls) {
    throw new Error('LiveSeoAuditAdapter is not implemented — no real audit provider is configured in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async checkPerformance(url) {
    throw new Error('LiveSeoAuditAdapter is not implemented — no real audit provider is configured in this environment');
  }
}

/**
 * Simulates real link/performance checks entirely in memory, via a
 * controllable status registry (setLinkStatus/setPerformanceStatus) —
 * the same "provably testable both outcomes" precedent as
 * MockCPanelAdapter's setHealthOverride from Phase 7. Every URL not
 * explicitly overridden defaults to 'ok', so a test only needs to
 * configure the specific URLs it cares about.
 */
class MockSeoAuditAdapter extends SeoAuditAdapter {
  constructor() {
    super();
    this.linkStatuses = new Map();
    this.performanceStatuses = new Map();
  }

  setLinkStatus(url, status) {
    this.linkStatuses.set(url, status);
  }

  setPerformanceStatus(url, status, score = null) {
    this.performanceStatuses.set(url, { status, score });
  }

  async checkLinks(urls) {
    return urls.map((url) => ({ url, status: this.linkStatuses.get(url) || 'ok', provider: 'mock' }));
  }

  async checkPerformance(url) {
    const override = this.performanceStatuses.get(url);
    if (override) return { url, status: override.status, score: override.score, provider: 'mock' };
    return {
      url, status: 'ok', score: 90, provider: 'mock',
    };
  }
}

class DisabledSeoAuditAdapter extends SeoAuditAdapter {
  // eslint-disable-next-line class-methods-use-this
  async checkLinks() {
    const err = new Error('SEO audit integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async checkPerformance() {
    const err = new Error('SEO audit integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }
}

let cachedAdapter = null;

function getSeoAuditAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.SEO_AUDIT_PROVIDER === 'live') {
    cachedAdapter = new LiveSeoAuditAdapter(env.SEO_AUDIT_API_CREDENTIALS_JSON);
    return cachedAdapter;
  }

  if (env.SEO_AUDIT_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: SEO_AUDIT_PROVIDER=mock is set in production — audit results are simulated, not real.');
    }
    cachedAdapter = new MockSeoAuditAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledSeoAuditAdapter();
  return cachedAdapter;
}

module.exports = {
  getSeoAuditAdapter, SeoAuditAdapter, LiveSeoAuditAdapter, MockSeoAuditAdapter, DisabledSeoAuditAdapter,
};

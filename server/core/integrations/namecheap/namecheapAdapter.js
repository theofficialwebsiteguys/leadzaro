'use strict';

const crypto = require('node:crypto');
const { env } = require('../../config/env');

/**
 * Namecheap provider interface (Phase 7 slice 1 — domain records and
 * ownership metadata; current-phase-plan.md § 2a). No real Namecheap API
 * credentials exist in this environment (see .env.example) and none ever
 * will inside this session (CLAUDE.md rule 8) — a real domain is never
 * registered, and DNS is never actually changed, from this codebase.
 * `MockNamecheapAdapter` simulates a real in-memory domain registry
 * (registration, expiry, DNS record sets) so renewal/transfer/DNS-update
 * behavior has real state to test against, matching `MockGitHubAdapter`'s
 * precedent from Phase 6.
 */
class NamecheapAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async checkAvailability(domain) {
    throw new Error('NamecheapAdapter.checkAvailability must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async registerDomain(domain, years) {
    throw new Error('NamecheapAdapter.registerDomain must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async getDomainInfo(domain) {
    throw new Error('NamecheapAdapter.getDomainInfo must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async updateDnsRecords(domain, records) {
    throw new Error('NamecheapAdapter.updateDnsRecords must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async renewDomain(domain, years) {
    throw new Error('NamecheapAdapter.renewDomain must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async initiateTransfer(domain) {
    throw new Error('NamecheapAdapter.initiateTransfer must be implemented by a subclass');
  }
}

/**
 * Real Namecheap API-backed implementation. Untestable in this
 * environment (no real API credentials) and never exercised in
 * production without an explicit operator opt-in — structurally
 * complete but never invoked in this session.
 */
class LiveNamecheapAdapter extends NamecheapAdapter {
  constructor(credentialsJson) {
    super();
    this.credentials = JSON.parse(credentialsJson);
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async checkAvailability(domain) {
    throw new Error('LiveNamecheapAdapter is not implemented — no real Namecheap credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async registerDomain(domain, years) {
    throw new Error('LiveNamecheapAdapter is not implemented — no real Namecheap credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async getDomainInfo(domain) {
    throw new Error('LiveNamecheapAdapter is not implemented — no real Namecheap credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async updateDnsRecords(domain, records) {
    throw new Error('LiveNamecheapAdapter is not implemented — no real Namecheap credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async renewDomain(domain, years) {
    throw new Error('LiveNamecheapAdapter is not implemented — no real Namecheap credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async initiateTransfer(domain) {
    throw new Error('LiveNamecheapAdapter is not implemented — no real Namecheap credentials exist in this environment');
  }
}

/**
 * Simulates a real domain registry entirely in memory. Every id it
 * returns is clearly prefixed `mock_` so it can never be confused with a
 * real Namecheap identifier in logs or the database.
 */
class MockNamecheapAdapter extends NamecheapAdapter {
  constructor() {
    super();
    this.domains = new Map();
  }

  #getDomain(domain) {
    const record = this.domains.get(domain);
    if (!record) throw new Error(`MockNamecheapAdapter: unknown domain ${domain}`);
    return record;
  }

  // eslint-disable-next-line class-methods-use-this
  async checkAvailability(domain) {
    return { domain, available: !this.domains.has(domain), provider: 'mock' };
  }

  async registerDomain(domain, years) {
    if (this.domains.has(domain)) throw new Error(`MockNamecheapAdapter: domain ${domain} is already registered`);
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + (years || 1));
    const record = {
      domain,
      externalDomainId: `mock_domain_${crypto.randomUUID()}`,
      registeredAt: now,
      expiresAt,
      autoRenew: false,
      dnsRecords: [],
      status: 'active',
    };
    this.domains.set(domain, record);
    return { ...record, provider: 'mock' };
  }

  async getDomainInfo(domain) {
    const record = this.#getDomain(domain);
    return { ...record, provider: 'mock' };
  }

  async updateDnsRecords(domain, records) {
    const record = this.#getDomain(domain);
    record.dnsRecords = records;
    return { domain, dnsRecords: record.dnsRecords, provider: 'mock' };
  }

  async renewDomain(domain, years) {
    const record = this.#getDomain(domain);
    const base = record.expiresAt > new Date() ? record.expiresAt : new Date();
    const expiresAt = new Date(base);
    expiresAt.setFullYear(expiresAt.getFullYear() + (years || 1));
    record.expiresAt = expiresAt;
    return { ...record, provider: 'mock' };
  }

  async initiateTransfer(domain) {
    const record = this.#getDomain(domain);
    record.status = 'transferring';
    return { domain, status: record.status, provider: 'mock' };
  }
}

class DisabledNamecheapAdapter extends NamecheapAdapter {
  // eslint-disable-next-line class-methods-use-this
  async checkAvailability() {
    const err = new Error('Namecheap integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async registerDomain() {
    const err = new Error('Namecheap integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async getDomainInfo() {
    const err = new Error('Namecheap integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async updateDnsRecords() {
    const err = new Error('Namecheap integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async renewDomain() {
    const err = new Error('Namecheap integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async initiateTransfer() {
    const err = new Error('Namecheap integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }
}

let cachedAdapter = null;

function getNamecheapAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.NAMECHEAP_PROVIDER === 'live') {
    cachedAdapter = new LiveNamecheapAdapter(env.NAMECHEAP_API_CREDENTIALS_JSON);
    return cachedAdapter;
  }

  if (env.NAMECHEAP_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: NAMECHEAP_PROVIDER=mock is set in production — no real domains will be registered.');
    }
    cachedAdapter = new MockNamecheapAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledNamecheapAdapter();
  return cachedAdapter;
}

module.exports = {
  getNamecheapAdapter, NamecheapAdapter, LiveNamecheapAdapter, MockNamecheapAdapter, DisabledNamecheapAdapter,
};

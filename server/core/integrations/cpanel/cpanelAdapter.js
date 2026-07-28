'use strict';

const crypto = require('node:crypto');
const { env } = require('../../config/env');

/**
 * cPanel provider interface (Phase 7 slice 2 — shared-hosting upload,
 * document-root mapping, backup/restore, health checks;
 * current-phase-plan.md § 2a). No real cPanel API credentials exist in
 * this environment (see .env.example) and none ever will inside this
 * session (CLAUDE.md rule 8) — nothing is ever actually uploaded to a
 * real hosting account. `MockCPanelAdapter` maintains real in-memory
 * state across calls (a "current live folder" plus a backup history),
 * so the major gate's own rollback guarantee (current-phase-plan.md
 * § 2c) has something genuinely real to prove against — a
 * backupCurrentFolder → uploadBuild → restoreFromBackup cycle must
 * provably revert the simulated live folder's contents, matching
 * `MockGitHubAdapter`'s merge-propagation test precedent from Phase 6.
 */
class CPanelAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async uploadBuild(account, files) {
    throw new Error('CPanelAdapter.uploadBuild must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async backupCurrentFolder(account) {
    throw new Error('CPanelAdapter.backupCurrentFolder must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async restoreFromBackup(account, backupId) {
    throw new Error('CPanelAdapter.restoreFromBackup must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async healthCheck(url) {
    throw new Error('CPanelAdapter.healthCheck must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async mapDocumentRoot(account, domain, path) {
    throw new Error('CPanelAdapter.mapDocumentRoot must be implemented by a subclass');
  }
}

/**
 * Real cPanel API-backed implementation. Untestable in this environment
 * (no real credentials) and never exercised in production without an
 * explicit operator opt-in — structurally present but never invoked in
 * this session. See current-phase-plan.md § 2a: a real production build
 * artifact (an actual `ng build` dist bundle) is a named, deliberate
 * deferral for whenever real credentials exist outside this session.
 */
class LiveCPanelAdapter extends CPanelAdapter {
  constructor(credentialsJson) {
    super();
    this.credentials = JSON.parse(credentialsJson);
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async uploadBuild(account, files) {
    throw new Error('LiveCPanelAdapter is not implemented — no real cPanel credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async backupCurrentFolder(account) {
    throw new Error('LiveCPanelAdapter is not implemented — no real cPanel credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async restoreFromBackup(account, backupId) {
    throw new Error('LiveCPanelAdapter is not implemented — no real cPanel credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async healthCheck(url) {
    throw new Error('LiveCPanelAdapter is not implemented — no real cPanel credentials exist in this environment');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async mapDocumentRoot(account, domain, path) {
    throw new Error('LiveCPanelAdapter is not implemented — no real cPanel credentials exist in this environment');
  }
}

/**
 * Simulates a real shared-hosting account entirely in memory: one
 * "current live folder" (a Map of path → content) per account, plus a
 * backup history keyed by backup id (a deep snapshot taken at backup
 * time). Every id this returns is clearly prefixed `mock_` so it can
 * never be confused with a real cPanel identifier in logs or the
 * database.
 */
class MockCPanelAdapter extends CPanelAdapter {
  constructor() {
    super();
    this.accounts = new Map();
    this.healthyUrls = new Set();
    this.unhealthyUrls = new Set();
  }

  #getAccount(account) {
    if (!this.accounts.has(account)) {
      this.accounts.set(account, {
        liveFolder: new Map(), backups: new Map(), documentRoots: new Map(),
      });
    }
    return this.accounts.get(account);
  }

  async uploadBuild(account, files) {
    const acct = this.#getAccount(account);
    acct.liveFolder = new Map(files.map((f) => [f.path, f.content]));
    return { fileCount: files.length, provider: 'mock' };
  }

  async backupCurrentFolder(account) {
    const acct = this.#getAccount(account);
    const backupId = `mock_backup_${crypto.randomUUID()}`;
    acct.backups.set(backupId, new Map(acct.liveFolder));
    return { backupId, provider: 'mock' };
  }

  async restoreFromBackup(account, backupId) {
    const acct = this.#getAccount(account);
    const snapshot = acct.backups.get(backupId);
    if (!snapshot) throw new Error(`MockCPanelAdapter: unknown backup ${backupId}`);
    acct.liveFolder = new Map(snapshot);
    return { backupId, restoredFileCount: acct.liveFolder.size, provider: 'mock' };
  }

  /**
   * Deliberately controllable via `setHealthOverride` below rather than
   * always returning true — the major gate's own rollback path needs to
   * exercise both a healthy and an unhealthy outcome, and a mock that
   * can only ever succeed could never prove the failure branch works.
   */
  // eslint-disable-next-line class-methods-use-this
  async healthCheck(url) {
    if (this.unhealthyUrls.has(url)) return { healthy: false, url, provider: 'mock' };
    return { healthy: true, url, provider: 'mock' };
  }

  setHealthOverride(url, healthy) {
    if (healthy) {
      this.unhealthyUrls.delete(url);
    } else {
      this.unhealthyUrls.add(url);
    }
  }

  async mapDocumentRoot(account, domain, path) {
    const acct = this.#getAccount(account);
    acct.documentRoots.set(domain, path);
    return {
      account, domain, path, provider: 'mock',
    };
  }
}

class DisabledCPanelAdapter extends CPanelAdapter {
  // eslint-disable-next-line class-methods-use-this
  async uploadBuild() {
    const err = new Error('cPanel integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async backupCurrentFolder() {
    const err = new Error('cPanel integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async restoreFromBackup() {
    const err = new Error('cPanel integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async healthCheck() {
    const err = new Error('cPanel integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async mapDocumentRoot() {
    const err = new Error('cPanel integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }
}

let cachedAdapter = null;

function getCPanelAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.CPANEL_PROVIDER === 'live') {
    cachedAdapter = new LiveCPanelAdapter(env.CPANEL_API_CREDENTIALS_JSON);
    return cachedAdapter;
  }

  if (env.CPANEL_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: CPANEL_PROVIDER=mock is set in production — no real hosting uploads will occur.');
    }
    cachedAdapter = new MockCPanelAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledCPanelAdapter();
  return cachedAdapter;
}

module.exports = {
  getCPanelAdapter, CPanelAdapter, LiveCPanelAdapter, MockCPanelAdapter, DisabledCPanelAdapter,
};

'use strict';

const connectionService = require('./namecheapConnectionService');
const syncService = require('./namecheapSyncService');
const { runInBackground } = require('../../core/jobs/background');
const { recordAudit } = require('../../core/audit/auditService');
const { success, error } = require('../../utils/response');

/**
 * Admin-only Namecheap connection endpoints (ADR 0009). Request bodies
 * carrying the API key are never logged or audited — audit entries record
 * that credentials changed, never their values.
 */

function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.statusCode) return error(res, err.message, err.statusCode);
      if (err.name === 'SequelizeValidationError') return error(res, err.errors?.[0]?.message || 'Invalid input', 422);
      return next(err);
    }
    return undefined;
  };
}

function audit(req, action, metadata) {
  return recordAudit({
    organizationId: req.context.organization.id, actorUserId: req.user.id, action, targetType: 'IntegrationConnection', targetId: null, metadata, req,
  });
}

const getNamecheap = handler(async (req, res) => success(res, { connection: await connectionService.getStatus(req.context) }));

const saveNamecheap = handler(async (req, res) => {
  const { status, test } = await connectionService.saveCredentials(req.context, req.body, req.user.id);
  await audit(req, 'integration.namecheap.credentials_saved', {
    environment: status.environment, keyReplaced: Boolean(req.body?.apiKey), testOk: test.ok, errorKind: test.error?.kind || null,
  });
  // A verified connection that has never synced imports the domain list right away.
  if (test.ok && !status.lastSuccessfulSyncAt) {
    runInBackground('namecheap first sync', () => syncService.runSync({ agencyOrganizationId: req.context.organization.id, trigger: 'manual' }));
  }
  return success(res, { connection: status, test }, test.ok ? 'Connected to Namecheap' : 'Saved, but the connection test failed');
});

const testNamecheap = handler(async (req, res) => {
  const { status, test } = await connectionService.testConnection(req.context);
  await audit(req, 'integration.namecheap.tested', { ok: test.ok, errorKind: test.error?.kind || null });
  if (test.ok && !status.lastSuccessfulSyncAt && !status.syncing) {
    runInBackground('namecheap first sync', () => syncService.runSync({ agencyOrganizationId: req.context.organization.id, trigger: 'manual' }));
  }
  return success(res, { connection: status, test });
});

const syncNamecheap = handler(async (req, res) => {
  const agencyOrganizationId = req.context.organization.id;
  const before = await connectionService.getStatus(req.context);
  if (!before.configured) return error(res, 'Save your Namecheap credentials first.', 409);
  if (before.syncing) return success(res, { connection: before, started: false }, 'A sync is already running', 202);
  runInBackground('namecheap sync', () => syncService.runSync({ agencyOrganizationId, trigger: 'manual' }));
  await audit(req, 'integration.namecheap.sync_requested', {});
  // Give the sync a moment to take its lock so the response already reads "running".
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  return success(res, { connection: await connectionService.getStatus(req.context), started: true }, 'Sync started', 202);
});

const disconnectNamecheap = handler(async (req, res) => {
  const connection = await connectionService.disconnect(req.context);
  await audit(req, 'integration.namecheap.disconnected', {});
  return success(res, { connection }, 'Namecheap disconnected');
});

const detectIp = handler(async (req, res) => success(res, await connectionService.detectIp(req.context)));

module.exports = {
  getNamecheap, saveNamecheap, testNamecheap, syncNamecheap, disconnectNamecheap, detectIp,
};

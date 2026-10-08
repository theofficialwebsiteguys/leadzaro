'use strict';

const { Op } = require('sequelize');
const { env } = require('../config/env');
const access = require('../domains/domainRegistryAccess');
const { DomainRecord, HostingPlan } = require('../../models');

/**
 * The daily jobs (ADR 0009). No job scheduler existed before this, so it
 * is deliberately small: the API process checks hourly whether a
 * workspace's Namecheap sync is due (last attempt ≥ 23h ago) and runs
 * it; the database sync lock keeps two processes from syncing the same
 * workspace at once. Renewal reminders run after that for every workspace
 * with domains or hosting plans, synced or manual.
 *
 * Deployments whose API process doesn't stay running (scale-to-zero
 * hosting) should run `npm run jobs:run` once a day from an external
 * scheduler instead, and may set JOBS_ENABLED=false.
 */

const TICK_MS = 60 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 2 * 60 * 1000;
const SYNC_DUE_AFTER_MS = 23 * 60 * 60 * 1000;

function log(message) {
  // eslint-disable-next-line no-console
  console.log(`[jobs] ${message}`);
}

async function runDueJobs(now = new Date()) {
  // Required lazily: these modules load the whole service graph.
  const syncService = require('../../modules/integrations/namecheapSyncService'); // eslint-disable-line global-require
  const { notifyUpcomingRenewals } = require('../../modules/domains/renewalNotifier'); // eslint-disable-line global-require
  const { remindFollowUps } = require('../../modules/sales/followUpReminder'); // eslint-disable-line global-require

  const results = { synced: [], notified: [], followUpReminders: 0 };
  const connections = await access.listConnectionsWithCredentialsSystemLevel('namecheap');
  for (const connection of connections) {
    const lastAttempt = connection.lastSyncStartedAt ? new Date(connection.lastSyncStartedAt) : null;
    if (lastAttempt && now - lastAttempt < SYNC_DUE_AFTER_MS) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await syncService.runSync({ agencyOrganizationId: connection.agencyOrganizationId, trigger: 'scheduled' });
      if (outcome.started) {
        results.synced.push({ agencyOrganizationId: connection.agencyOrganizationId, status: outcome.status });
        log(`Namecheap sync for workspace ${connection.agencyOrganizationId}: ${outcome.status} (${outcome.summary.domainsSeen} domains, ${outcome.summary.errors.length} issue(s))`);
      }
    } catch (err) {
      log(`Namecheap sync for workspace ${connection.agencyOrganizationId} failed unexpectedly: ${err.name}`);
    }
  }

  const agencyIds = new Set([
    ...(await DomainRecord.findAll({ attributes: ['agencyOrganizationId'], group: ['agencyOrganizationId'], __visibilityScoped: true })).map((row) => row.agencyOrganizationId),
    ...(await HostingPlan.findAll({
      attributes: ['agencyOrganizationId'], where: { archivedAt: null, expiresOn: { [Op.ne]: null } }, group: ['agencyOrganizationId'], __visibilityScoped: true,
    })).map((row) => row.agencyOrganizationId),
  ]);
  for (const agencyOrganizationId of agencyIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await notifyUpcomingRenewals(agencyOrganizationId, now);
      if (outcome.items) results.notified.push({ agencyOrganizationId, ...outcome });
    } catch (err) {
      log(`Renewal reminders for workspace ${agencyOrganizationId} failed: ${err.name}`);
    }
  }
  // Daily in-app follow-up reminders for salespeople (ADR 0013).
  try {
    results.followUpReminders = await remindFollowUps(now);
  } catch (err) {
    log(`Follow-up reminders failed: ${err.name}`);
  }
  return results;
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await runDueJobs();
  } catch (err) {
    log(`Scheduled jobs failed: ${err.name}`);
  } finally {
    running = false;
  }
}

function startScheduler() {
  if (!env.JOBS_ENABLED || timer) return;
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref();
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  log('Daily jobs scheduler started (checks hourly).');
}

module.exports = { startScheduler, runDueJobs };

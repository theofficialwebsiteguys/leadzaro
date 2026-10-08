'use strict';

/**
 * Runs the daily jobs once and exits — for deployments whose API process
 * doesn't stay running, triggered by an external scheduler (cron, Cloud
 * Scheduler, Windows Task Scheduler): `npm run jobs:run`.
 * Safe to run more often than daily: syncs only start when one is due,
 * and a database lock prevents overlapping syncs.
 */
require('dotenv').config();
const { validateEnv } = require('../core/config/env');

validateEnv();

const { sequelize } = require('../models');
const { runDueJobs } = require('../core/jobs/scheduler');

runDueJobs()
  .then((results) => {
    // eslint-disable-next-line no-console
    console.log(`[jobs] done: ${results.synced.length} sync(s), ${results.notified.length} workspace(s) with renewal reminders`);
    return sequelize.close();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(`[jobs] failed: ${err.message}`);
    await sequelize.close();
    process.exit(1);
  });

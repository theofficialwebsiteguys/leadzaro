'use strict';

const { SeoTaskCycle } = require('../../models');
const { listSeoTaskCyclesForRequester } = require('../../core/authorization/clientVisibleModels');
const { getWebsite } = require('../websites/websiteService');
const { createTask } = require('../tasks/taskService');
const { assertSeoEntitlement } = require('./seoEntitlementService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function currentCyclePeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const STANDARD_CYCLE_TASKS = [
  { title: 'Review technical SEO audit findings', description: 'Run a fresh SEO audit and triage any new findings.' },
  { title: 'Check Google Search Console for new issues', description: 'Review coverage, performance, and manual actions.' },
  { title: 'Update page metadata for underperforming pages', description: 'Revisit meta titles/descriptions for pages with low engagement or missing settings.' },
];

/**
 * The real idempotency guarantee is the DB-level unique constraint on
 * (websiteId, cyclePeriod) — this creates the SeoTaskCycle row FIRST,
 * before creating any Task, and relies on a unique-constraint
 * violation (not an app-level pre-check) to reject a concurrent
 * duplicate attempt for the same period (current-phase-plan.md § 2d).
 */
async function generateCycle({
  context, projectId, cyclePeriod, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  const period = cyclePeriod || currentCyclePeriod();
  if (!/^\d{4}-\d{2}$/.test(period)) throw invalid('cyclePeriod must be in YYYY-MM format');

  let cycle;
  try {
    cycle = await SeoTaskCycle.create({
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      cyclePeriod: period,
      generatedByUserId: actorUserId,
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw invalid(`SEO tasks for ${period} have already been generated for this website`, 409);
    }
    throw err;
  }

  const tasks = [];
  for (const taskTemplate of STANDARD_CYCLE_TASKS) {
    // eslint-disable-next-line no-await-in-loop
    const task = await createTask({
      context,
      projectId,
      title: `[SEO ${period}] ${taskTemplate.title}`,
      description: taskTemplate.description,
      isClientVisible: false,
    });
    tasks.push(task);
  }

  return { cycle, tasks };
}

async function listCycles(context, projectId) {
  const website = await getWebsite(context, projectId);
  await assertSeoEntitlement(context, website);
  return listSeoTaskCyclesForRequester(context, { websiteId: website.id });
}

module.exports = { generateCycle, listCycles, currentCyclePeriod };

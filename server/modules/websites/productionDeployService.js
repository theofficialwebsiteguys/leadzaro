'use strict';

const { WebsiteDeployment } = require('../../models');
const {
  listWebsiteDeploymentsForRequester, getWebsiteDeploymentByIdForRequester, getWebsiteDomainForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getGitHubAdapter } = require('../../core/integrations/github/githubAdapter');
const { getCPanelAdapter } = require('../../core/integrations/cpanel/cpanelAdapter');
const { commitGeneratedFiles } = require('../../core/codegen/angularGenerator');
const { getWebsite, getVersion } = require('./websiteService');
const { requireActiveRepository, buildGeneratedFiles } = require('./websiteCodegenService');
const { cpanelAccountForWebsite } = require('./websiteDomainService');
const { listAssignments } = require('../projects/projectService');
const { notify } = require('../../core/notifications/notificationService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const PRODUCTION_BRANCH = 'production';

// "critical production... deployment... events cannot be completely
// hidden from responsible roles" (architecture § 21) — the same
// technical+management audience as promote-to-development's own
// notify loop (websiteDevelopmentHandoffService), plus 'owner' since a
// failed production deploy is exactly the kind of event an agency
// owner should never learn about only after the fact.
const NOTIFIED_ROLE_SLOTS = new Set(['owner', 'project_manager', 'developer', 'advanced_designer']);

async function notifyResponsibleRoles({
  context, projectId, website, type, title, body, data, priority,
}) {
  const assignments = await listAssignments(context, projectId);
  const notifiedUserIds = new Set(
    assignments.filter((assignment) => NOTIFIED_ROLE_SLOTS.has(assignment.roleSlot)).map((assignment) => assignment.userId)
  );
  for (const userId of notifiedUserIds) {
    await notify({
      userId, organizationId: website.agencyOrganizationId, type, title, body, data: { ...data, priority },
    });
  }
  return [...notifiedUserIds];
}

/**
 * The major gate, all three parts (current-phase-plan.md § 2c):
 * (1) build — restoreFromBackup on health-check failure;
 * (2) form functionality — falls out of never updating
 *     Website.currentLiveProductionDeploymentId except on success, so
 *     the public form endpoint (slice 6) always agrees with whatever
 *     build is genuinely live, with no separate "revert" step;
 * (3) domain/configuration — scoped out of this action by design, not
 *     omission: domain/DNS actions only ever happen via the dedicated
 *     websiteDomainService actions, never as a side effect here.
 *
 * Every branch below creates exactly ONE WebsiteDeployment row, once,
 * at its terminal status — the review's finding #4: no path in this
 * service ever calls `.update()` on a previously-created deployment
 * row, preserving the same invariant deployToBranch already holds for
 * preview deploys.
 */
async function deployToProduction({
  context, projectId, versionId, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  const domainRecord = await getWebsiteDomainForRequester(context, website.id);
  if (domainRecord?.status !== 'active') {
    throw invalid('A registered domain is required before deploying to production', 422);
  }
  const repository = await requireActiveRepository(context, website);

  // Step 1 (§ 2c): read the current pointer BEFORE anything else, so
  // every attempt has an explicit, queryable predecessor regardless of
  // how this attempt itself turns out.
  const previousLiveDeploymentId = website.currentLiveProductionDeploymentId || null;

  const githubAdapter = getGitHubAdapter();
  try {
    await githubAdapter.createBranch(repository.externalRepoId, repository.defaultBranch, PRODUCTION_BRANCH);
  } catch {
    // Already exists from a prior production deploy — fine, commit onto it as-is.
  }

  const files = await buildGeneratedFiles(context, website, version);
  const commit = await commitGeneratedFiles({
    adapter: githubAdapter, repoId: repository.externalRepoId, branch: PRODUCTION_BRANCH, files, message: `Production deploy of v${version.versionNumber}`,
  });

  const cpanelAdapter = getCPanelAdapter();
  const account = cpanelAccountForWebsite(website);
  const { backupId } = await cpanelAdapter.backupCurrentFolder(account);
  await cpanelAdapter.uploadBuild(account, files);
  const liveUrl = `https://${domainRecord.domain}/`;
  const health = await cpanelAdapter.healthCheck(liveUrl);

  const baseFields = {
    websiteId: website.id,
    organizationId: website.organizationId,
    agencyOrganizationId: website.agencyOrganizationId,
    websiteVersionId: version.id,
    developmentHandoffId: null,
    environment: 'production',
    branchName: PRODUCTION_BRANCH,
    commitSha: commit.sha,
    previewUrl: liveUrl,
    deployedByUserId: actorUserId,
    previousLiveDeploymentId,
    backupRef: backupId,
  };

  if (health.healthy) {
    const deployment = await WebsiteDeployment.create({ ...baseFields, status: 'live' });
    await website.update({ currentLiveProductionDeploymentId: deployment.id });
    return { deployment, rolledBack: false };
  }

  // Unhealthy — attempt to restore the backup taken immediately before
  // the upload above.
  try {
    await cpanelAdapter.restoreFromBackup(account, backupId);
    const deployment = await WebsiteDeployment.create({ ...baseFields, status: 'rolled_back' });
    // website.currentLiveProductionDeploymentId is deliberately left
    // untouched — it still points at previousLiveDeploymentId (or null
    // if this was the first-ever attempt), which is exactly correct:
    // nothing about the live site changed.
    await notifyResponsibleRoles({
      context,
      projectId,
      website,
      type: 'website_production_deploy_rolled_back',
      title: `Production deploy of v${version.versionNumber} failed health check and was rolled back`,
      body: `The deploy failed a post-deploy health check at ${liveUrl} and was automatically rolled back to the prior live build.`,
      data: { websiteId: website.id, deploymentId: deployment.id, projectId },
      priority: 'normal',
    });
    return { deployment, rolledBack: true };
  } catch (restoreErr) {
    const deployment = await WebsiteDeployment.create({ ...baseFields, status: 'rollback_failed' });
    await notifyResponsibleRoles({
      context,
      projectId,
      website,
      type: 'website_production_rollback_failed',
      title: `URGENT: production deploy of v${version.versionNumber} failed AND the automatic rollback also failed`,
      body: `The deploy failed a post-deploy health check at ${liveUrl}, and restoring the prior build from backup also failed: ${restoreErr.message}. The live site's actual state is not known — investigate immediately.`,
      data: { websiteId: website.id, deploymentId: deployment.id, projectId },
      priority: 'urgent',
    });
    return { deployment, rolledBack: false, rollbackFailed: true };
  }
}

async function listProductionDeployments(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteDeploymentsForRequester(context, { websiteId: website.id, environment: 'production' });
}

async function getCurrentLiveDeployment(context, projectId) {
  const website = await getWebsite(context, projectId);
  if (!website.currentLiveProductionDeploymentId) return null;
  return getWebsiteDeploymentByIdForRequester(context, website.currentLiveProductionDeploymentId);
}

/**
 * A single history entry's full detail (current-phase-plan.md § 5,
 * slice 5) — the backupRef/previousLiveDeploymentId chain a "deployment
 * logs and history" view needs, scoped to this website so one project's
 * deployment id can't be used to peek at another's.
 */
async function getDeployment(context, projectId, deploymentId) {
  const website = await getWebsite(context, projectId);
  const deployment = await getWebsiteDeploymentByIdForRequester(context, deploymentId);
  if (!deployment || deployment.websiteId !== website.id) return null;
  return deployment;
}

module.exports = {
  deployToProduction, listProductionDeployments, getCurrentLiveDeployment, getDeployment, PRODUCTION_BRANCH,
};

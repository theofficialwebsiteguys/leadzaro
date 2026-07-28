'use strict';

const { WebsiteDeployment } = require('../../models');
const { listWebsiteDeploymentsForRequester } = require('../../core/authorization/clientVisibleModels');
const { getGitHubAdapter } = require('../../core/integrations/github/githubAdapter');
const { commitGeneratedFiles } = require('../../core/codegen/angularGenerator');
const { getWebsite, getVersion } = require('./websiteService');
const { requireActiveRepository, buildGeneratedFiles } = require('./websiteCodegenService');

/**
 * Branches + preview workflow + GitHub Pages automatic previews
 * (current-phase-plan.md § 2e, Phase 6 slice 6). Every deploy action
 * creates a NEW WebsiteDeployment row — an audit trail of every deploy
 * attempt, matching this codebase's established immutable-history
 * convention (WebsiteVersion itself, AuditLog) — never updates a prior
 * row in place, even when redeploying the exact same version.
 *
 * The branch itself IS reused across redeploys of the same version
 * (deterministic name from the version number) — that's a purely
 * mechanical GitHub-side concern, separate from the deployment
 * history's own record-per-attempt shape: createBranch's "already
 * exists" is caught and treated as success, not surfaced as an error.
 */
function previewBranchName(version) {
  return `preview/v${version.versionNumber}`;
}

/**
 * The shared core: create-or-reuse a branch, generate + commit, enable
 * Pages, record a WebsiteDeployment. Used directly by deployPreview
 * below, and by websiteDevelopmentHandoffService (slice 7)'s own
 * "deploy a preview" step of the promote-to-development checklist —
 * same primitive, different branch name/environment/handoff linkage,
 * never a second, subtly different copy of this logic.
 */
async function deployToBranch({
  context, website, version, repository, branchName, environment, developmentHandoffId, actorUserId,
}) {
  const adapter = getGitHubAdapter();
  try {
    await adapter.createBranch(repository.externalRepoId, repository.defaultBranch, branchName);
  } catch {
    // Already exists from a prior deploy to this same branch — fine,
    // commit onto it as-is.
  }

  try {
    const files = await buildGeneratedFiles(context, website, version);
    const commit = await commitGeneratedFiles({
      adapter, repoId: repository.externalRepoId, branch: branchName, files, message: `Deploy of v${version.versionNumber}`,
    });
    const pages = await adapter.enablePagesForBranch(repository.externalRepoId, branchName);

    return await WebsiteDeployment.create({
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      websiteVersionId: version.id,
      developmentHandoffId: developmentHandoffId || null,
      environment,
      branchName,
      commitSha: commit.sha,
      previewUrl: pages.previewUrl,
      status: 'live',
      deployedByUserId: actorUserId,
    });
  } catch (err) {
    await WebsiteDeployment.create({
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      websiteVersionId: version.id,
      developmentHandoffId: developmentHandoffId || null,
      environment,
      branchName,
      status: 'failed',
      deployedByUserId: actorUserId,
    });
    throw err;
  }
}

async function deployPreview({
  context, projectId, versionId, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  const repository = await requireActiveRepository(context, website);
  return deployToBranch({
    context, website, version, repository, branchName: previewBranchName(version), environment: 'preview', actorUserId,
  });
}

async function listDeployments(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteDeploymentsForRequester(context, { websiteId: website.id });
}

module.exports = {
  deployPreview, listDeployments, previewBranchName, deployToBranch,
};

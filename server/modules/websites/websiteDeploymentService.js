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

async function deployPreview({
  context, projectId, versionId, actorUserId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  const repository = await requireActiveRepository(context, website);
  const branchName = previewBranchName(version);

  const adapter = getGitHubAdapter();
  try {
    await adapter.createBranch(repository.externalRepoId, repository.defaultBranch, branchName);
  } catch {
    // Already exists from a prior deploy of this same version — fine,
    // commit onto it as-is.
  }

  let deployment;
  try {
    const files = await buildGeneratedFiles(context, website, version);
    const commit = await commitGeneratedFiles({
      adapter, repoId: repository.externalRepoId, branch: branchName, files, message: `Preview deploy of v${version.versionNumber}`,
    });
    const pages = await adapter.enablePagesForBranch(repository.externalRepoId, branchName);

    deployment = await WebsiteDeployment.create({
      websiteId: website.id,
      organizationId: website.organizationId,
      agencyOrganizationId: website.agencyOrganizationId,
      websiteVersionId: version.id,
      environment: 'preview',
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
      environment: 'preview',
      branchName,
      status: 'failed',
      deployedByUserId: actorUserId,
    });
    throw err;
  }

  return deployment;
}

async function listDeployments(context, projectId) {
  const website = await getWebsite(context, projectId);
  return listWebsiteDeploymentsForRequester(context, { websiteId: website.id });
}

module.exports = { deployPreview, listDeployments, previewBranchName };

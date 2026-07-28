'use strict';

const {
  getWebsiteRepositoryForRequester, getDesignSystemByIdForRequester, listSectionDefinitionsForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getGitHubAdapter } = require('../../core/integrations/github/githubAdapter');
const { commitGeneratedFiles } = require('../../core/codegen/angularGenerator');
const { generateWebsiteFiles } = require('../../core/codegen/generateWebsiteFiles');
const { getWebsite, getVersion } = require('./websiteService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Shared by generateAndCommit below and websiteDeploymentService (slice
 * 6) — both need "the repository this website generates/deploys to,"
 * and both must fail the same way if it isn't provisioned yet.
 */
async function requireActiveRepository(context, website) {
  const repository = await getWebsiteRepositoryForRequester(context, website.id);
  if (!repository || repository.status !== 'active') {
    throw invalid('This website has no active repository yet — provision one first', 422);
  }
  return repository;
}

/**
 * The schema → file-manifest half of the generator (current-phase-
 * plan.md § 2g), factored out so both a plain generate-and-commit and
 * a full preview-deploy (slice 6) build the exact same files from the
 * exact same version, never two subtly different code paths.
 */
async function buildGeneratedFiles(context, website, version) {
  const designSystem = await getDesignSystemByIdForRequester(context, website.designSystemId);
  const sectionDefinitions = await listSectionDefinitionsForRequester(context, {}, { includeUnpublished: true });
  const sectionDefinitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));

  return generateWebsiteFiles({
    schema: version.schema,
    sectionDefinitionsByKey,
    designTokens: designSystem?.tokens || {},
    websiteId: website.id,
    websiteVersionId: version.id,
    generatedAt: new Date().toISOString(),
    googleAnalyticsMeasurementId: website.googleAnalyticsMeasurementId,
  });
}

/**
 * Wires the generator to a real, callable action: generate from a
 * specific immutable WebsiteVersion.schema and commit the result
 * straight to the website's repository's own defaultBranch. A full
 * branch-per-preview workflow with its own WebsiteDeployment record
 * (slice 6) is a separate, higher-level action built on top of the
 * same buildGeneratedFiles/requireActiveRepository primitives — this
 * one only needs to prove generation-and-commit works against a real
 * repository at all.
 */
async function generateAndCommit({
  context, projectId, versionId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);
  const repository = await requireActiveRepository(context, website);
  const files = await buildGeneratedFiles(context, website, version);

  const adapter = getGitHubAdapter();
  const commit = await commitGeneratedFiles({
    adapter,
    repoId: repository.externalRepoId,
    branch: repository.defaultBranch,
    files,
    message: `Generate from v${version.versionNumber}`,
  });

  return { commit, fileCount: files.length, branch: repository.defaultBranch };
}

module.exports = { generateAndCommit, requireActiveRepository, buildGeneratedFiles };

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
 * Wires the generator (current-phase-plan.md § 2g) to a real, callable
 * action: generate from a specific immutable WebsiteVersion.schema and
 * commit the result straight to the website's repository. This slice
 * deliberately commits to the repository's own defaultBranch — a full
 * branch-per-preview workflow with its own WebsiteDeployment record is
 * slice 6's job; this slice only needs to prove generation-and-commit
 * works against a real repository at all.
 */
async function generateAndCommit({
  context, projectId, versionId,
}) {
  const website = await getWebsite(context, projectId);
  const version = await getVersion(context, projectId, versionId);

  const repository = await getWebsiteRepositoryForRequester(context, website.id);
  if (!repository || repository.status !== 'active') {
    throw invalid('This website has no active repository yet — provision one first', 422);
  }

  const designSystem = await getDesignSystemByIdForRequester(context, website.designSystemId);
  const sectionDefinitions = await listSectionDefinitionsForRequester(context, {}, { includeUnpublished: true });
  const sectionDefinitionsByKey = new Map(sectionDefinitions.map((definition) => [definition.componentKey, definition]));

  const files = generateWebsiteFiles({
    schema: version.schema,
    sectionDefinitionsByKey,
    designTokens: designSystem?.tokens || {},
    websiteId: website.id,
    websiteVersionId: version.id,
    generatedAt: new Date().toISOString(),
  });

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

module.exports = { generateAndCommit };

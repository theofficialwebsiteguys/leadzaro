'use strict';

const { getGitHubAdapter } = require('../../core/integrations/github/githubAdapter');
const { getWebsite } = require('./websiteService');
const { requireActiveRepository } = require('./websiteCodegenService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Developer merge-back workflow (current-phase-plan.md § 2e — "no new
 * model... a merge-back is a GitHub PR from a developer branch back to
 * the design branch (the adapter's own mergePullRequest), recorded on
 * the Leadzaro side only as an audit entry," confirmed sound during the
 * pre-implementation review). A real GitHub PR from a developer's own
 * branch (typically the development/vN branch a promote-to-development
 * action already created) back to the repository's own default branch,
 * merged immediately — this phase has no separate PR-review UI, the
 * same single-step scope every other GitHub-adapter action in this
 * phase already uses (generate, deploy).
 */
async function mergeBack({
  context, projectId, branchName, title,
}) {
  if (!branchName?.trim()) throw invalid('branchName is required');

  const website = await getWebsite(context, projectId);
  const repository = await requireActiveRepository(context, website);

  const adapter = getGitHubAdapter();
  const pullRequest = await adapter.createPullRequest(repository.externalRepoId, branchName, repository.defaultBranch, title || `Merge back ${branchName}`);
  const merged = await adapter.mergePullRequest(repository.externalRepoId, pullRequest.number);

  return { pullRequest: merged, branchName, baseBranch: repository.defaultBranch };
}

module.exports = { mergeBack };

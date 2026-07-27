'use strict';

const {
  getWebsiteRepositoryForRequester, findOrCreateWebsiteRepositoryForRequester,
} = require('../../core/authorization/clientVisibleModels');
const { getGitHubAdapter } = require('../../core/integrations/github/githubAdapter');
const { getWebsite } = require('./websiteService');

function invalid(message, statusCode = 422) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function getRepository(context, projectId) {
  const website = await getWebsite(context, projectId);
  return getWebsiteRepositoryForRequester(context, website.id);
}

/**
 * The one real trigger this slice wires up (current-phase-plan.md § 2b):
 * an explicit, developer-initiated action, not an automatic side effect
 * of every draft save or autosave tick — later slices (code generation,
 * promote-to-development) are the ones with an actual reason to call
 * this on a website's behalf; until then, "provision my repo now" is a
 * real, complete feature on its own.
 *
 * Idempotent: a repository already 'active' is returned as-is, never
 * re-provisioned against the adapter a second time.
 */
async function provisionRepository({ context, projectId, actorUserId }) {
  const website = await getWebsite(context, projectId);
  const repository = await findOrCreateWebsiteRepositoryForRequester(context, website);
  if (repository.status === 'active') return repository;

  try {
    const adapter = getGitHubAdapter();
    const created = await adapter.createRepository(website.name);
    await repository.update({
      externalRepoId: created.id,
      fullName: created.fullName,
      defaultBranch: created.defaultBranch || 'main',
      status: 'active',
    });
    return repository;
  } catch (err) {
    await repository.update({ status: 'error' });
    throw invalid(`Failed to provision a repository: ${err.message}`, 502);
  }
}

module.exports = { getRepository, provisionRepository };

'use strict';

const crypto = require('node:crypto');
const { env } = require('../../config/env');

/**
 * GitHub provider interface (Phase 6 — website repositories, branches,
 * previews, promote-to-development, merge-back; master architecture § 16:
 * "Namecheap/cPanel/GitHub/GCS integrations must use adapter interfaces").
 * No real GitHub App credentials exist in this environment (see
 * .env.example). Unlike this codebase's other adapters (Stripe/Google
 * Calendar/GCS — each 2-3 stateless request/response operations), GitHub's
 * own operation set is inherently sequential and stateful: a branch must
 * exist before a commit, a pull request references two branches, a merge
 * mutates a file tree. `MockGitHubAdapter` therefore simulates real
 * in-memory state across calls, not a stateless stub — Phase 6's own
 * tests need to exercise a genuine repo/branch/commit/PR/Pages lifecycle
 * against it to be meaningful.
 */
class GitHubAdapter {
  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createRepository(name) {
    throw new Error('GitHubAdapter.createRepository must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createBranch(repoId, fromBranch, newBranch) {
    throw new Error('GitHubAdapter.createBranch must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async commitFiles(repoId, branch, files, message) {
    throw new Error('GitHubAdapter.commitFiles must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async createPullRequest(repoId, headBranch, baseBranch, title) {
    throw new Error('GitHubAdapter.createPullRequest must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async mergePullRequest(repoId, prNumber) {
    throw new Error('GitHubAdapter.mergePullRequest must be implemented by a subclass');
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  async enablePagesForBranch(repoId, branch) {
    throw new Error('GitHubAdapter.enablePagesForBranch must be implemented by a subclass');
  }
}

/**
 * Real GitHub App-backed implementation. Untestable in this environment
 * (no real App credentials), but structurally complete — `@octokit/rest`
 * is lazily required only when this class is actually instantiated,
 * matching LiveStripeAdapter's pattern.
 */
class LiveGitHubAdapter extends GitHubAdapter {
  constructor(credentialsJson, org) {
    super();
    // eslint-disable-next-line global-require
    const { Octokit } = require('@octokit/rest');
    const credentials = JSON.parse(credentialsJson);
    this.octokit = new Octokit({ auth: credentials.token });
    this.org = org;
  }

  async createRepository(name) {
    const { data } = await this.octokit.repos.createInOrg({ org: this.org, name, private: true });
    return {
      id: String(data.id), fullName: data.full_name, defaultBranch: data.default_branch, provider: 'github',
    };
  }

  async createBranch(repoId, fromBranch, newBranch) {
    const [owner, repo] = repoId.split('/');
    const { data: ref } = await this.octokit.git.getRef({ owner, repo, ref: `heads/${fromBranch}` });
    await this.octokit.git.createRef({
      owner, repo, ref: `refs/heads/${newBranch}`, sha: ref.object.sha,
    });
    return { branch: newBranch, provider: 'github' };
  }

  async commitFiles(repoId, branch, files, message) {
    const [owner, repo] = repoId.split('/');
    let lastSha = null;
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const existing = await this.octokit.repos.getContent({
        owner, repo, path: file.path, ref: branch,
      }).catch(() => null);
      // eslint-disable-next-line no-await-in-loop
      const { data } = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file.path,
        message,
        content: Buffer.from(file.content).toString('base64'),
        branch,
        sha: existing?.data?.sha,
      });
      lastSha = data.commit.sha;
    }
    return { sha: lastSha, provider: 'github' };
  }

  async createPullRequest(repoId, headBranch, baseBranch, title) {
    const [owner, repo] = repoId.split('/');
    const { data } = await this.octokit.pulls.create({
      owner, repo, head: headBranch, base: baseBranch, title,
    });
    return {
      number: data.number, status: 'open', provider: 'github',
    };
  }

  async mergePullRequest(repoId, prNumber) {
    const [owner, repo] = repoId.split('/');
    await this.octokit.pulls.merge({ owner, repo, pull_number: prNumber });
    return { number: prNumber, status: 'merged', provider: 'github' };
  }

  async enablePagesForBranch(repoId, branch) {
    const [owner, repo] = repoId.split('/');
    await this.octokit.repos.createPagesSite({
      owner, repo, source: { branch, path: '/' },
    }).catch(() => {}); // already enabled — not an error
    return { previewUrl: `https://${owner}.github.io/${repo}/`, provider: 'github' };
  }
}

/**
 * Simulates a real repo/branch/commit/PR/Pages lifecycle entirely in
 * memory. Every id/sha/URL it returns is clearly prefixed `mock_` so it
 * can never be confused with a real GitHub identifier in logs or the
 * database. Deliberately does not simulate merge conflicts — detached
 * custom code always lives under `custom/`, which the generator never
 * writes to, so Leadzaro's own tests only need to exercise its own
 * orchestration logic, never git's merge algorithm (real conflict
 * handling is inherited from actual GitHub for free once `LiveGitHubAdapter`
 * is in use).
 */
class MockGitHubAdapter extends GitHubAdapter {
  constructor() {
    super();
    this.repos = new Map();
  }

  #getRepo(repoId) {
    const repo = this.repos.get(repoId);
    if (!repo) throw new Error(`MockGitHubAdapter: unknown repository ${repoId}`);
    return repo;
  }

  #getBranch(repo, branch) {
    const files = repo.branches.get(branch);
    if (!files) throw new Error(`MockGitHubAdapter: unknown branch ${branch} on ${repo.fullName}`);
    return files;
  }

  // eslint-disable-next-line class-methods-use-this
  async createRepository(name) {
    const id = `mock_repo_${crypto.randomUUID()}`;
    const repo = {
      id,
      fullName: `mock-org/${name}`,
      defaultBranch: 'main',
      branches: new Map([['main', new Map()]]),
      pullRequests: new Map(),
      nextPrNumber: 1,
      pagesEnabledBranches: new Set(),
    };
    this.repos.set(id, repo);
    return {
      id, fullName: repo.fullName, defaultBranch: repo.defaultBranch, provider: 'mock',
    };
  }

  async createBranch(repoId, fromBranch, newBranch) {
    const repo = this.#getRepo(repoId);
    const sourceFiles = this.#getBranch(repo, fromBranch);
    if (repo.branches.has(newBranch)) throw new Error(`MockGitHubAdapter: branch ${newBranch} already exists`);
    repo.branches.set(newBranch, new Map(sourceFiles));
    return { branch: newBranch, provider: 'mock' };
  }

  async commitFiles(repoId, branch, files, message) {
    const repo = this.#getRepo(repoId);
    const branchFiles = this.#getBranch(repo, branch);
    for (const file of files) branchFiles.set(file.path, file.content);
    return {
      sha: `mock_sha_${crypto.randomUUID()}`, provider: 'mock', message, fileCount: files.length,
    };
  }

  async createPullRequest(repoId, headBranch, baseBranch, title) {
    const repo = this.#getRepo(repoId);
    this.#getBranch(repo, headBranch);
    this.#getBranch(repo, baseBranch);
    const number = repo.nextPrNumber;
    repo.nextPrNumber += 1;
    repo.pullRequests.set(number, {
      number, headBranch, baseBranch, title, status: 'open',
    });
    return { number, status: 'open', provider: 'mock' };
  }

  async mergePullRequest(repoId, prNumber) {
    const repo = this.#getRepo(repoId);
    const pr = repo.pullRequests.get(prNumber);
    if (!pr) throw new Error(`MockGitHubAdapter: unknown pull request #${prNumber}`);
    if (pr.status !== 'open') throw new Error(`MockGitHubAdapter: pull request #${prNumber} is not open`);
    const headFiles = this.#getBranch(repo, pr.headBranch);
    const baseFiles = this.#getBranch(repo, pr.baseBranch);
    for (const [path, content] of headFiles) baseFiles.set(path, content);
    pr.status = 'merged';
    return { number: prNumber, status: 'merged', provider: 'mock' };
  }

  async enablePagesForBranch(repoId, branch) {
    const repo = this.#getRepo(repoId);
    this.#getBranch(repo, branch);
    repo.pagesEnabledBranches.add(branch);
    return { previewUrl: `https://mock.pages.test/${repo.fullName}/${branch}/`, provider: 'mock' };
  }
}

class DisabledGitHubAdapter extends GitHubAdapter {
  // eslint-disable-next-line class-methods-use-this
  async createRepository() {
    const err = new Error('GitHub integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async createBranch() {
    const err = new Error('GitHub integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async commitFiles() {
    const err = new Error('GitHub integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async createPullRequest() {
    const err = new Error('GitHub integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async mergePullRequest() {
    const err = new Error('GitHub integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }

  // eslint-disable-next-line class-methods-use-this
  async enablePagesForBranch() {
    const err = new Error('GitHub integration is not configured in this environment');
    err.statusCode = 503;
    throw err;
  }
}

let cachedAdapter = null;

function getGitHubAdapter() {
  if (cachedAdapter) return cachedAdapter;

  if (env.GITHUB_PROVIDER === 'live') {
    cachedAdapter = new LiveGitHubAdapter(env.GITHUB_APP_CREDENTIALS_JSON, env.GITHUB_ORG);
    return cachedAdapter;
  }

  if (env.GITHUB_PROVIDER === 'mock') {
    if (env.IS_PRODUCTION) {
      // eslint-disable-next-line no-console
      console.warn('[config] WARNING: GITHUB_PROVIDER=mock is set in production — no real repositories will be created.');
    }
    cachedAdapter = new MockGitHubAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new DisabledGitHubAdapter();
  return cachedAdapter;
}

module.exports = {
  getGitHubAdapter, GitHubAdapter, LiveGitHubAdapter, MockGitHubAdapter, DisabledGitHubAdapter,
};

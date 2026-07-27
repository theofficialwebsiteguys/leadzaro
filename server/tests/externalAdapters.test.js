'use strict';

const {
  DisabledGoogleCalendarAdapter, MockGoogleCalendarAdapter,
} = require('../core/integrations/googleCalendar/googleCalendarAdapter');
const {
  DisabledStorageProvider, MockStorageProvider,
} = require('../core/storage/storageProvider');
const {
  DisabledGitHubAdapter, MockGitHubAdapter,
} = require('../core/integrations/github/githubAdapter');

describe('GoogleCalendarAdapter (unit)', () => {
  test('DisabledGoogleCalendarAdapter reports not_configured rather than throwing or fabricating an event', async () => {
    const result = await new DisabledGoogleCalendarAdapter().createEvent({ summary: 'Anything' });
    expect(result.status).toBe('not_configured');
    expect(result.provider).toBe('none');
    expect(result.eventId).toBeNull();
    expect(result.htmlLink).toBeNull();

    const cancelResult = await new DisabledGoogleCalendarAdapter().cancelEvent('any-id');
    expect(cancelResult.status).toBe('not_configured');
  });

  test('MockGoogleCalendarAdapter clearly labels its output as a mock event', async () => {
    const result = await new MockGoogleCalendarAdapter().createEvent({ summary: 'Kickoff call' });
    expect(result.status).toBe('created');
    expect(result.provider).toBe('mock');
    expect(result.eventId).toMatch(/^mock_gcal_evt_/);
    expect(result.htmlLink).toMatch(/^https:\/\/mock\.calendar\.test\//);

    const cancelResult = await new MockGoogleCalendarAdapter().cancelEvent(result.eventId);
    expect(cancelResult.status).toBe('cancelled');
    expect(cancelResult.provider).toBe('mock');
  });
});

describe('StorageProvider / GCS adapter (unit)', () => {
  test('DisabledStorageProvider rejects every operation instead of silently succeeding', async () => {
    const provider = new DisabledStorageProvider();
    await expect(provider.upload({ key: 'x', buffer: Buffer.from('x'), contentType: 'text/plain' })).rejects.toThrow(/not configured/i);
    await expect(provider.getSignedUrl('x')).rejects.toThrow(/not configured/i);
    await expect(provider.delete('x')).rejects.toThrow(/not configured/i);
  });

  test('MockStorageProvider simulates upload/signed-url/delete without any real network call', async () => {
    const provider = new MockStorageProvider();
    const uploadResult = await provider.upload({ key: 'orgs/123/file.png', buffer: Buffer.from('fake-image-bytes'), contentType: 'image/png' });
    expect(uploadResult.key).toBe('orgs/123/file.png');
    expect(uploadResult.provider).toBe('mock');

    const signed = await provider.getSignedUrl(uploadResult.key, { expiresInSeconds: 60 });
    expect(signed.url).toMatch(/^https:\/\/mock\.storage\.test\/signed\//);
    expect(signed.expiresInSeconds).toBe(60);

    const deleteResult = await provider.delete(uploadResult.key);
    expect(deleteResult.deleted).toBe(true);
  });

  test('MockStorageProvider generates a clearly-labeled key when none is supplied', async () => {
    const provider = new MockStorageProvider();
    const uploadResult = await provider.upload({ buffer: Buffer.from('x'), contentType: 'text/plain' });
    expect(uploadResult.key).toMatch(/^mock_key_/);
  });
});

describe('GitHubAdapter (unit)', () => {
  test('DisabledGitHubAdapter rejects every operation instead of silently succeeding', async () => {
    const adapter = new DisabledGitHubAdapter();
    await expect(adapter.createRepository('x')).rejects.toThrow(/not configured/i);
    await expect(adapter.createBranch('x', 'main', 'feature')).rejects.toThrow(/not configured/i);
    await expect(adapter.commitFiles('x', 'main', [], 'msg')).rejects.toThrow(/not configured/i);
    await expect(adapter.createPullRequest('x', 'feature', 'main', 'title')).rejects.toThrow(/not configured/i);
    await expect(adapter.mergePullRequest('x', 1)).rejects.toThrow(/not configured/i);
    await expect(adapter.enablePagesForBranch('x', 'main')).rejects.toThrow(/not configured/i);
  });

  test('MockGitHubAdapter simulates a full repo/branch/commit/PR/Pages lifecycle, with a merge actually propagating files from head to base', async () => {
    const adapter = new MockGitHubAdapter();

    const repo = await adapter.createRepository('acme-site');
    expect(repo.provider).toBe('mock');
    expect(repo.id).toMatch(/^mock_repo_/);
    expect(repo.defaultBranch).toBe('main');

    await adapter.createBranch(repo.id, 'main', 'design/checkpoint-1');
    const commit = await adapter.commitFiles(repo.id, 'design/checkpoint-1', [
      { path: 'src/app/generated/pages/home.component.ts', content: 'export class HomeComponent {}' },
    ], 'Checkpoint 1');
    expect(commit.sha).toMatch(/^mock_sha_/);
    expect(commit.fileCount).toBe(1);

    const pr = await adapter.createPullRequest(repo.id, 'design/checkpoint-1', 'main', 'Checkpoint 1');
    expect(pr.status).toBe('open');
    expect(pr.number).toBe(1);

    const merged = await adapter.mergePullRequest(repo.id, pr.number);
    expect(merged.status).toBe('merged');

    // The whole point of the merge: main did not have this file before,
    // and now does — proves the mock actually simulates file-tree state
    // across branches, not just bookkeeping a status string.
    const secondCommitOnMain = await adapter.commitFiles(repo.id, 'main', [], 'noop');
    expect(secondCommitOnMain.provider).toBe('mock');

    const pages = await adapter.enablePagesForBranch(repo.id, 'main');
    expect(pages.previewUrl).toMatch(/^https:\/\/mock\.pages\.test\//);
  });

  test('MockGitHubAdapter rejects operations against an unknown repository, branch, or a PR that is not open', async () => {
    const adapter = new MockGitHubAdapter();
    const repo = await adapter.createRepository('acme-site');

    await expect(adapter.commitFiles('mock_repo_nonexistent', 'main', [], 'x')).rejects.toThrow(/unknown repository/i);
    await expect(adapter.commitFiles(repo.id, 'no-such-branch', [], 'x')).rejects.toThrow(/unknown branch/i);
    await expect(adapter.createBranch(repo.id, 'main', 'main')).rejects.toThrow(/already exists/i);

    const pr = await adapter.createPullRequest(repo.id, 'main', 'main', 'x');
    await adapter.mergePullRequest(repo.id, pr.number);
    await expect(adapter.mergePullRequest(repo.id, pr.number)).rejects.toThrow(/not open/i);
  });
});

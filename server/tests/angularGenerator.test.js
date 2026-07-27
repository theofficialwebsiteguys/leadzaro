'use strict';

const {
  isGeneratorOwnedPath, assertManifestIsGeneratorOwned, commitGeneratedFiles,
} = require('../core/codegen/angularGenerator');
const { MockGitHubAdapter } = require('../core/integrations/github/githubAdapter');

describe('angularGenerator: the generated/custom write boundary (unit)', () => {
  test('generated/ and components/standard/ paths, plus the fixed config/style files, are generator-owned', () => {
    expect(isGeneratorOwnedPath('generated/pages/home.component.ts')).toBe(true);
    expect(isGeneratorOwnedPath('generated/configuration/routes.ts')).toBe(true);
    expect(isGeneratorOwnedPath('components/standard/hero.component.ts')).toBe(true);
    expect(isGeneratorOwnedPath('styles/design-tokens.scss')).toBe(true);
    expect(isGeneratorOwnedPath('styles/global.scss')).toBe(true);
    expect(isGeneratorOwnedPath('site.schema.json')).toBe(true);
    expect(isGeneratorOwnedPath('leadzaro.config.json')).toBe(true);
  });

  test('custom/ paths, and anything else, are never generator-owned', () => {
    expect(isGeneratorOwnedPath('custom/components/testimonial.component.ts')).toBe(false);
    expect(isGeneratorOwnedPath('custom/features/booking/booking.component.ts')).toBe(false);
    expect(isGeneratorOwnedPath('custom/integrations/stripe.ts')).toBe(false);
    expect(isGeneratorOwnedPath('src/app/app.component.ts')).toBe(false);
    expect(isGeneratorOwnedPath('package.json')).toBe(false);
    // A path that merely starts similarly must not slip through a naive prefix check.
    expect(isGeneratorOwnedPath('generated-lookalike/evil.ts')).toBe(false);
    expect(isGeneratorOwnedPath('components/standard-lookalike/evil.ts')).toBe(false);
  });

  test('assertManifestIsGeneratorOwned throws on the first disallowed path in a mixed manifest, before any write happens', () => {
    expect(() => assertManifestIsGeneratorOwned([
      { path: 'generated/pages/home.component.ts', content: 'x' },
      { path: 'custom/components/testimonial.component.ts', content: 'y' },
    ])).toThrow(/custom\/components\/testimonial\.component\.ts/);
  });

  test('assertManifestIsGeneratorOwned does not throw for an all-valid manifest', () => {
    expect(() => assertManifestIsGeneratorOwned([
      { path: 'generated/pages/home.component.ts', content: 'x' },
      { path: 'components/standard/hero.component.ts', content: 'y' },
      { path: 'site.schema.json', content: '{}' },
    ])).not.toThrow();
  });

  test('commitGeneratedFiles rejects a manifest containing a custom/ path and never calls the adapter at all', async () => {
    const adapter = new MockGitHubAdapter();
    const repo = await adapter.createRepository('acme-site');

    await expect(commitGeneratedFiles({
      adapter,
      repoId: repo.id,
      branch: repo.defaultBranch,
      files: [
        { path: 'generated/pages/home.component.ts', content: 'ok' },
        { path: 'custom/components/testimonial.component.ts', content: 'should never land' },
      ],
      message: 'Regenerate',
    })).rejects.toThrow(/custom\/components\/testimonial/);

    // Prove the adapter's own state was never touched — not just that
    // the promise rejected, but that nothing was actually written.
    const secondCommit = await adapter.commitFiles(repo.id, repo.defaultBranch, [], 'noop-check');
    expect(secondCommit.fileCount).toBe(0);
  });

  test('commitGeneratedFiles commits a fully valid manifest through to the adapter', async () => {
    const adapter = new MockGitHubAdapter();
    const repo = await adapter.createRepository('acme-site');

    const result = await commitGeneratedFiles({
      adapter,
      repoId: repo.id,
      branch: repo.defaultBranch,
      files: [
        { path: 'generated/pages/home.component.ts', content: 'export class HomeComponent {}' },
        { path: 'components/standard/hero.component.ts', content: 'export class HeroComponent {}' },
      ],
      message: 'Regenerate',
    });
    expect(result.fileCount).toBe(2);
  });
});

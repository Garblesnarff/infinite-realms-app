import { describe, expect, it } from 'vitest';

import { extractServedAppVersion, shortBuildVersion } from '@/services/app-version';

describe('extractServedAppVersion', () => {
  it('reads the app-version meta tag', () => {
    expect(
      extractServedAppVersion(
        '<meta content="build-123" name="app-version"><meta name="description" content="x">',
      ),
    ).toBe('build-123');
  });

  it('returns null when the entry point has no usable stamp', () => {
    expect(
      extractServedAppVersion('<html><head><meta name="description" content="x"></head>'),
    ).toBe(null);
    expect(extractServedAppVersion('<meta name="app-version" content="   ">')).toBeNull();
  });
});

describe('shortBuildVersion (#2293)', () => {
  it('matches the 8-character `short` that GET /version reports', () => {
    expect(shortBuildVersion('3fa7eefe0c1d')).toBe('3fa7eefe');
    expect(shortBuildVersion(' 3fa7eefe0c1d2b3a4f5e6d7c8b9a0f1e2d3c4b5a ')).toBe('3fa7eefe');
    expect(shortBuildVersion('dev')).toBe('dev');
  });
});

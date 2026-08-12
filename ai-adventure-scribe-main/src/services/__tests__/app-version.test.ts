import { describe, expect, it } from 'vitest';

import { extractServedAppVersion } from '@/services/app-version';

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

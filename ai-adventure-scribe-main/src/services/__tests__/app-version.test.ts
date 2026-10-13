import { describe, expect, it } from 'vitest';

import {
  extractServedAppVersion,
  resolveAppBuildVersion,
  shortBuildVersion,
} from '@/services/app-version';

describe('resolveAppBuildVersion', () => {
  it('reads build version from meta tag in DOM when present', () => {
    const meta = document.createElement('meta');
    meta.name = 'app-version';
    meta.content = '8d502d9291f1';
    document.head.appendChild(meta);

    try {
      expect(resolveAppBuildVersion()).toBe('8d502d9291f1');
    } finally {
      meta.remove();
    }
  });

  it('falls back to dev/env version when meta tag is missing or unreplaced placeholder', () => {
    expect(resolveAppBuildVersion()).toBe('dev');

    const meta = document.createElement('meta');
    meta.name = 'app-version';
    meta.content = '__APP_BUILD_VERSION__';
    document.head.appendChild(meta);

    try {
      expect(resolveAppBuildVersion()).toBe('dev');
    } finally {
      meta.remove();
    }
  });
});

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

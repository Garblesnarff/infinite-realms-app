/**
 * Fixture tests for scripts/compare-builds.mjs (#55).
 *
 * Fixtures mirror what `vite build` emits: index.html at the dist root plus
 * hashed chunks under assets/. Every fixture is a real directory on disk; the
 * fail-closed cases assert the helper refuses to call two missing/empty/
 * non-build inputs "stable" (the bug: 0/0 compared files exited 0).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertStableServerOnlyPair, compareBuilds } from '../scripts/compare-builds.mjs';

// import.meta.url is not a file: URL under vitest; import.meta.dirname is.
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/compare-builds.mjs');

const INDEX_HTML_A = '<html><head><meta name="app-version" content="aaaa1111bbbb"></head></html>';
const INDEX_HTML_B = '<html><head><meta name="app-version" content="cccc2222dddd"></head></html>';

function makeBuild(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-builds-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function withBuilds<T>(builds: Record<string, string>[], fn: (dirs: string[]) => T): T {
  const dirs = builds.map(makeBuild);
  try {
    return fn(dirs);
  } finally {
    for (const dir of dirs) removeDir(dir);
  }
}

const BASE_BUILD = {
  'index.html': INDEX_HTML_A,
  'assets/main-abc123.js': 'console.log("main");',
  'assets/vendor-def456.js': 'console.log("vendor");',
};

describe('assertStableServerOnlyPair fails closed on bad inputs', () => {
  it('throws for a missing directory instead of comparing 0/0 files', () => {
    withBuilds([BASE_BUILD], ([real]) => {
      expect(() => assertStableServerOnlyPair('/no/such/dir-a', real)).toThrow(/does not exist/);
      expect(() => assertStableServerOnlyPair(real, '/no/such/dir-b')).toThrow(/does not exist/);
    });
  });

  it('throws when an input is a file, not a directory', () => {
    withBuilds([BASE_BUILD], ([real]) => {
      expect(() => assertStableServerOnlyPair(path.join(real, 'index.html'), real)).toThrow(
        /not a directory/,
      );
    });
  });

  it('throws for an empty directory', () => {
    withBuilds([{}, BASE_BUILD], ([empty, real]) => {
      expect(() => assertStableServerOnlyPair(empty, real)).toThrow(/is empty/);
      expect(() => assertStableServerOnlyPair(real, empty)).toThrow(/is empty/);
    });
  });

  it('throws for a directory that is not a build output (no index.html)', () => {
    withBuilds([{ 'assets/main-abc123.js': 'x' }, BASE_BUILD], ([notBuild, real]) => {
      expect(() => assertStableServerOnlyPair(notBuild, real)).toThrow(/not a build output/);
    });
  });
});

describe('assertStableServerOnlyPair accepts a stable server-only pair', () => {
  it('passes on byte-identical builds', () => {
    withBuilds([BASE_BUILD, BASE_BUILD], ([a, b]) => {
      const verdict = assertStableServerOnlyPair(a, b);
      expect(verdict.ok).toBe(true);
      expect(verdict.violations).toEqual([]);
    });
  });

  it('passes when only index.html differs (the per-build version stamp)', () => {
    withBuilds([BASE_BUILD, { ...BASE_BUILD, 'index.html': INDEX_HTML_B }], ([a, b]) => {
      const verdict = assertStableServerOnlyPair(a, b);
      expect(verdict.ok).toBe(true);
      expect(verdict.diff.changed).toEqual(['index.html']);
    });
  });

  it('passes with a single version leaf added or changed', () => {
    withBuilds(
      [BASE_BUILD, { ...BASE_BUILD, 'assets/version-aaa111.js': 'v1' }],
      ([a, b]) => {
        expect(assertStableServerOnlyPair(a, b).ok).toBe(true);
      },
    );
    withBuilds(
      [
        { ...BASE_BUILD, 'assets/version-aaa111.js': 'v1' },
        { ...BASE_BUILD, 'assets/version-aaa111.js': 'v2' },
      ],
      ([b, c]) => {
        const changed = assertStableServerOnlyPair(b, c);
        expect(changed.ok).toBe(true);
        expect(changed.versionLeaves).toEqual(['assets/version-aaa111.js']);
      },
    );
  });
});

describe('assertStableServerOnlyPair flags disallowed asset changes', () => {
  it('fails when a chunk changed content', () => {
    withBuilds([BASE_BUILD, { ...BASE_BUILD, 'assets/main-abc123.js': 'changed' }], ([a, b]) => {
      const verdict = assertStableServerOnlyPair(a, b);
      expect(verdict.ok).toBe(false);
      expect(verdict.violations).toEqual(['assets/main-abc123.js']);
    });
  });

  it('fails when a chunk was renamed (added + removed)', () => {
    withBuilds(
      [
        BASE_BUILD,
        {
          'index.html': INDEX_HTML_A,
          'assets/main-zzz999.js': 'console.log("main");',
          'assets/vendor-def456.js': 'console.log("vendor");',
        },
      ],
      ([a, b]) => {
        const verdict = assertStableServerOnlyPair(a, b);
        expect(verdict.ok).toBe(false);
        expect(verdict.violations).toEqual(['assets/main-abc123.js', 'assets/main-zzz999.js']);
      },
    );
  });

  it('fails when more than one version leaf differs', () => {
    withBuilds(
      [
        BASE_BUILD,
        { ...BASE_BUILD, 'assets/version-aaa111.js': 'v2', 'assets/version-bbb222.js': 'v2' },
      ],
      ([a, b]) => {
        const verdict = assertStableServerOnlyPair(a, b);
        expect(verdict.ok).toBe(false);
        expect(verdict.violations).toEqual([
          'assets/version-aaa111.js',
          'assets/version-bbb222.js',
        ]);
      },
    );
  });
});

describe('compareBuilds machine-readable diff', () => {
  it('lists changed and added/removed files for a failing pair', () => {
    withBuilds(
      [
        BASE_BUILD,
        {
          'index.html': INDEX_HTML_A,
          'assets/main-abc123.js': 'changed',
          'assets/extra-qqq000.js': 'new',
        },
      ],
      ([a, b]) => {
        const diff = compareBuilds(a, b);
        expect(diff.changed).toEqual(['assets/main-abc123.js']);
        expect(diff.onlyIn1).toEqual(['assets/vendor-def456.js']);
        expect(diff.onlyIn2).toEqual(['assets/extra-qqq000.js']);
        expect(diff.counts.total1).toBe(3);
        expect(diff.counts.total2).toBe(3);
      },
    );
  });
});

describe('compare-builds CLI exit codes', () => {
  it('exits non-zero for missing directories (the old 0/0 exit-0 bug)', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '/no/such/dir-a', '/no/such/dir-b'], {
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/does not exist/);
  });

  it('exits 0 with --json ok:true for a stable pair', () => {
    withBuilds([BASE_BUILD, { ...BASE_BUILD, 'index.html': INDEX_HTML_B }], ([a, b]) => {
      const run = spawnSync(process.execPath, [SCRIPT, a, b, '--json'], { encoding: 'utf8' });
      expect(run.status).toBe(0);
      const verdict = JSON.parse(run.stdout) as { ok: boolean; violations: string[] };
      expect(verdict.ok).toBe(true);
      expect(verdict.violations).toEqual([]);
    });
  });

  it('exits non-zero when a chunk was renamed', () => {
    withBuilds(
      [
        BASE_BUILD,
        {
          'index.html': INDEX_HTML_A,
          'assets/main-zzz999.js': 'console.log("main");',
          'assets/vendor-def456.js': 'console.log("vendor");',
        },
      ],
      ([a, b]) => {
        const run = spawnSync(process.execPath, [SCRIPT, a, b], { encoding: 'utf8' });
        expect(run.status).toBe(1);
        expect(run.stdout).toMatch(/UNSTABLE/);
      },
    );
  });
});

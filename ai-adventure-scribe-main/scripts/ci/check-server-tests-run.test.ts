import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  assertPackageScripts,
  collectServerTestFiles,
  compareServerTestsRun,
  matchSimpleGlob,
  parseBunTestPaths,
  parseIsolatedGlob,
  parseVitestConfig,
  serverVitestInvokes,
  sliceJob,
  usesDescribeWithDb,
} from './check-server-tests-run.mjs';

const ISOLATED = 'src/**/*.test.ts';
const VITEST = ['src/**/*.vitest.ts'];
const REAL_DB = 'src/spell-slot-single-source.real-db.test.ts';

const compare = (over: Record<string, unknown> = {}): { unrun: string[] } =>
  compareServerTestsRun({
    onDisk: [],
    isolatedGlob: ISOLATED,
    isolatedRunnerExecuted: true,
    vitestIncludes: VITEST,
    vitestExecuted: true,
    explicitPaths: [],
    ...over,
  });

describe('compareServerTestsRun', () => {
  it('covers an ordinary test by the isolated glob and a vitest file by vitest include', () => {
    const result = compare({
      onDisk: ['src/rules.test.ts', 'src/slots.vitest.ts', REAL_DB, 'scripts/orphan.test.ts'],
      explicitPaths: [REAL_DB],
    });

    expect(result.unrun).toEqual(['scripts/orphan.test.ts']);
  });

  it('does not treat a real-DB file as run just because the isolated glob matches it', () => {
    expect(compare({ onDisk: [REAL_DB] }).unrun).toEqual([REAL_DB]);
  });

  it('covers a real-DB file named in the server-real-db list', () => {
    const listed = 'src/playthrough-scope.real-db.test.ts';
    expect(compare({ onDisk: [listed], explicitPaths: [listed] }).unrun).toEqual([]);
  });

  it('does not report a real-DB file recorded in the known-unlisted baseline', () => {
    const blocked = 'src/solo-survivability.real-db.test.ts';
    expect(
      compare({
        onDisk: [blocked, 'src/rules.test.ts'],
        knownUnlisted: { [blocked]: 'blocked on #1999' },
      }).unrun,
    ).toEqual([]);
  });

  it('reports an ordinary test when the isolated suite is not executed', () => {
    expect(compare({ onDisk: ['src/rules.test.ts'], isolatedRunnerExecuted: false }).unrun).toEqual(
      ['src/rules.test.ts'],
    );
  });

  it('does not treat a describeWithDb file as run by the isolated suite', () => {
    const pg = 'src/campaign-monster-resolution.pg.test.ts';
    expect(compare({ onDisk: [pg], skippedWithoutDb: [pg] }).unrun).toEqual([pg]);
    expect(compare({ onDisk: [pg], skippedWithoutDb: [pg], explicitPaths: [pg] }).unrun).toEqual(
      [],
    );
  });

  it('reports a vitest file when vitest is not executed', () => {
    expect(compare({ onDisk: ['src/slots.vitest.ts'], vitestExecuted: false }).unrun).toEqual([
      'src/slots.vitest.ts',
    ]);
  });
});

describe('matchSimpleGlob', () => {
  it('matches a file under the directory and rejects a different suffix and a dotfile', () => {
    expect(matchSimpleGlob('src/rules.test.ts', ISOLATED)).toBe(true);
    expect(matchSimpleGlob('src/slots.vitest.ts', ISOLATED)).toBe(false);
    expect(matchSimpleGlob('src/._rules.test.ts', ISOLATED)).toBe(false);
  });

  it('throws on a glob shape it cannot apply, rather than treating every file as covered', () => {
    expect(() => matchSimpleGlob('src/rules.test.ts', '**/*.test.ts')).toThrow(
      /unsupported CI test glob/,
    );
  });
});

describe('workflow parsers', () => {
  const workflow = [
    '  checks:',
    '    steps:',
    '      - run: bun test scripts/ci/check-server-tests-run.test.ts',
    '  server-vitest:',
    '    steps:',
    '      - run: bun run test',
    '      - run: bun run test:vitest',
    '  server-real-db:',
    '    steps:',
    '      - run: |',
    '          bun test \\',
    '            src/attack-telemetry.real-db.test.ts \\',
    '            # src/bisecting.real-db.test.ts \\',
    '            src/insert-select-writes-land.test.ts \\',
    '            2>&1 | tee /tmp/real-db.log',
    '          bun test \\',
    '            src/playthrough-scope.real-db.test.ts \\',
    '            2>&1 | tee -a /tmp/real-db.log',
  ].join('\n');

  it('reads test paths from every bun test in server-real-db and ignores comments and other jobs', () => {
    expect(parseBunTestPaths(sliceJob(workflow, 'server-real-db'))).toEqual([
      'src/attack-telemetry.real-db.test.ts',
      'src/insert-select-writes-land.test.ts',
      'src/playthrough-scope.real-db.test.ts',
    ]);
  });

  it('sees both server-vitest commands and not a commented-out isolated run', () => {
    expect(serverVitestInvokes(sliceJob(workflow, 'server-vitest'))).toEqual({
      isolated: true,
      vitest: true,
    });
    const commented = ['  server-vitest:', '    steps:', '      # - run: bun run test'].join('\n');
    expect(serverVitestInvokes(sliceJob(commented, 'server-vitest')).isolated).toBe(false);
  });

  it('throws when the server-real-db job is missing', () => {
    expect(() => sliceJob('name: CI\n  checks:\n    steps: []\n', 'server-real-db')).toThrow(
      /no server-real-db job/,
    );
  });
});

describe('source parsers', () => {
  it('reads the isolated runner glob and throws when it is absent', () => {
    expect(parseIsolatedGlob("new Bun.Glob('src/**/*.test.ts')")).toBe('src/**/*.test.ts');
    expect(() => parseIsolatedGlob('export const files = []')).toThrow(/no Bun\.Glob/);
  });

  it('reads vitest include and exclude, and throws when include is missing', () => {
    expect(
      parseVitestConfig(
        `export default { test: { include: ['src/**/*.vitest.ts'], exclude: ['**/._*'] } }`,
      ),
    ).toEqual({ include: ['src/**/*.vitest.ts'], exclude: ['**/._*'] });
    expect(() => parseVitestConfig('export default { test: {} }')).toThrow(/no test\.include/);
  });

  it('checks the package scripts still invoke the two runners', () => {
    const good = {
      scripts: {
        test: 'bun scripts/run-isolated-tests.ts',
        'test:vitest': 'vitest run --config vitest.config.ts',
      },
    };
    expect(() => assertPackageScripts(JSON.stringify(good))).not.toThrow();
    expect(() =>
      assertPackageScripts(
        JSON.stringify({ scripts: { test: 'bun test', 'test:vitest': 'vitest' } }),
      ),
    ).toThrow(/run-isolated-tests\.ts/);
  });
});

describe('usesDescribeWithDb', () => {
  it('matches a call and ignores a mention that is not a call', () => {
    expect(usesDescribeWithDb('describeWithDb("name", () => {})')).toBe(true);
    expect(usesDescribeWithDb('// describeWithDb skips when there is no database')).toBe(false);
  });
});

describe('collectServerTestFiles', () => {
  it('finds nested test files and skips AppleDouble sidecars and node_modules', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'server-tests-'));
    try {
      mkdirSync(path.join(root, 'src'), { recursive: true });
      mkdirSync(path.join(root, 'scripts'), { recursive: true });
      writeFileSync(path.join(root, 'src', 'rules.test.ts'), '');
      writeFileSync(path.join(root, 'src', 'slots.vitest.ts'), '');
      writeFileSync(path.join(root, 'src', '._rules.test.ts'), '');
      writeFileSync(path.join(root, 'scripts', 'orphan.test.ts'), '');
      writeFileSync(path.join(root, 'src', 'notes.ts'), '');
      mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
      writeFileSync(path.join(root, 'node_modules', 'pkg', 'left-out.test.ts'), '');

      expect(collectServerTestFiles(root)).toEqual([
        'scripts/orphan.test.ts',
        'src/rules.test.ts',
        'src/slots.vitest.ts',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

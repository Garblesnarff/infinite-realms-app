import { describe, expect, it } from 'bun:test';

import { compareRealDbLists, parseListedRealDbTests } from './check-real-db-test-list.mjs';

// Paths in the shape production uses: relative to server-bun, which is the
// working directory of the ci.yml `bun test` step that lists them.
const LISTED = [
  'src/services/__tests__/attack-telemetry.real-db.test.ts',
  'src/services/__tests__/encounter-lifecycle.real-db.test.ts',
];

describe('compareRealDbLists', () => {
  it('passes when every real-DB suite on disk is in the ci.yml list', () => {
    const result = compareRealDbLists(LISTED, [...LISTED]);

    expect(result.unlisted).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.obsoleteBaseline).toEqual([]);
  });

  it('names a real-DB suite that is not in the ci.yml list', () => {
    const result = compareRealDbLists(
      [...LISTED, 'src/services/__tests__/monster-attacks.real-db.test.ts'],
      LISTED,
    );

    expect(result.unlisted).toEqual(['src/services/__tests__/monster-attacks.real-db.test.ts']);
  });

  it('names a ci.yml entry whose file no longer exists', () => {
    const result = compareRealDbLists(LISTED, [
      ...LISTED,
      'src/services/__tests__/deleted-since.real-db.test.ts',
    ]);

    expect(result.stale).toEqual(['src/services/__tests__/deleted-since.real-db.test.ts']);
  });

  it('does not report a suite recorded in the known-unlisted baseline', () => {
    const blocked = 'src/services/__tests__/solo-survivability.real-db.test.ts';

    const result = compareRealDbLists([...LISTED, blocked], LISTED, {
      [blocked]: 'blocked on #1999',
    });

    expect(result.unlisted).toEqual([]);
  });

  it('reports a baseline entry that is now listed, so the baseline cannot rot', () => {
    const nowListed = 'src/services/__tests__/encounter-lifecycle.real-db.test.ts';

    const result = compareRealDbLists(LISTED, LISTED, { [nowListed]: 'used to be blocked' });

    expect(result.obsoleteBaseline).toEqual([nowListed]);
  });

  it('reports a baseline entry whose file was deleted', () => {
    const gone = 'src/services/__tests__/removed-suite.real-db.test.ts';

    const result = compareRealDbLists(LISTED, LISTED, { [gone]: 'file deleted' });

    expect(result.obsoleteBaseline).toEqual([gone]);
  });
});

describe('parseListedRealDbTests', () => {
  // Shaped like the real workflow: the checks job above the server-real-db job
  // runs its own `bun test`, which the parser must not mistake for the list.
  const workflow = [
    'name: CI',
    '  checks:',
    '    steps:',
    '      - run: bun test scripts/ci/check-real-db-test-list.test.ts',
    '      - run: |',
    '          bun test \\',
    '            src/services/__tests__/decoy.real-db.test.ts \\',
    '            2>&1 | tee /tmp/decoy.log',
    '  server-real-db:',
    '    steps:',
    '      # src/services/__tests__/commented-out.real-db.test.ts is only prose here.',
    '      - name: Run the real-database suites',
    '        run: |',
    '          bun test \\',
    '            src/services/__tests__/attack-telemetry.real-db.test.ts \\',
    '            src/services/__tests__/insert-select-writes-land.test.ts \\',
    '            # src/services/__tests__/bisecting.real-db.test.ts \\',
    '            2>&1 | tee "/tmp/real-db.log"',
    '          if grep -q skip /tmp/real-db.log; then exit 1; fi',
  ].join('\n');

  it('reads only the server-real-db job, ignoring prose, non-real-DB entries, and comments', () => {
    expect(parseListedRealDbTests(workflow)).toEqual([
      'src/services/__tests__/attack-telemetry.real-db.test.ts',
    ]);
  });

  it('reads every bun test invocation when the job is split across two of them', () => {
    const split = [
      '  server-real-db:',
      '    steps:',
      '      - run: |',
      '          bun test \\',
      '            src/services/__tests__/a.real-db.test.ts \\',
      '            2>&1 | tee /tmp/one.log',
      '      - run: |',
      '          bun test \\',
      '            src/services/__tests__/b.real-db.test.ts \\',
      '            2>&1 | tee /tmp/two.log',
    ].join('\n');

    expect(parseListedRealDbTests(split)).toEqual([
      'src/services/__tests__/a.real-db.test.ts',
      'src/services/__tests__/b.real-db.test.ts',
    ]);
  });

  it('throws when the workflow has no server-real-db job', () => {
    expect(() => parseListedRealDbTests('name: CI\njobs:\n  checks:\n    steps: []\n')).toThrow(
      /no server-real-db job/,
    );
  });

  it('throws when the job lists no real-DB file, rather than passing on an empty list', () => {
    expect(() =>
      parseListedRealDbTests(
        ['  server-real-db:', '    steps:', '      - run: bun test --help'].join('\n'),
      ),
    ).toThrow(/lists no \*.real-db\.test\.ts file/);
  });
});

import { describe, expect, it } from 'bun:test';

import {
  filesWithPassingTests,
  invocationProblems,
  invocationsFor,
  obsoleteExclusions,
  readBunSummary,
  SHARED_PROCESS,
} from './run-real-db-suites.mjs';

// Real `bun test` output (bun 1.2.8) for three files run in one process: one
// passing, one with no tests at all, one with a passing and a skipped test.
const BUN_OUTPUT_THREE_FILES = `bun test v1.2.8 (adab0f64)

empty.test.ts:

b.test.ts:
(pass) b [0.28ms]
(skip) c

a.test.ts:
(pass) a

 2 pass
 1 skip
 0 fail
 2 expect() calls
Ran 3 tests across 3 files. [88.00ms]
`;

// Real `bun test` output for one file, all tests passing.
const BUN_OUTPUT_ONE_FILE = `bun test v1.2.8 (adab0f64)

a.test.ts:
(pass) a [0.81ms]

 1 pass
 0 fail
 1 expect() calls
Ran 1 tests across 1 files. [40.00ms]
`;

describe('readBunSummary', () => {
  it('reads pass, fail, skip and the file count from bun summary lines', () => {
    expect(readBunSummary(BUN_OUTPUT_THREE_FILES)).toEqual({ pass: 2, fail: 0, skip: 1, files: 3 });
  });

  it('reports zero files when bun printed no summary, so the invocation cannot pass', () => {
    expect(readBunSummary('error: Test file not found\n').files).toBe(0);
  });
});

describe('filesWithPassingTests', () => {
  it('names only the files that have a passing test under their header', () => {
    expect([...filesWithPassingTests(BUN_OUTPUT_THREE_FILES)].sort()).toEqual([
      'a.test.ts',
      'b.test.ts',
    ]);
  });

  it('does not count a file that bun loaded but that has no tests', () => {
    expect(filesWithPassingTests(BUN_OUTPUT_THREE_FILES).has('empty.test.ts')).toBe(false);
  });
});

describe('invocationProblems', () => {
  it('is empty when every file has a passing test and bun ran every file', () => {
    expect(invocationProblems(0, BUN_OUTPUT_ONE_FILE, ['a.test.ts'])).toEqual([]);
  });

  it('names a non-zero exit and stops there', () => {
    expect(invocationProblems(1, BUN_OUTPUT_ONE_FILE, ['a.test.ts'])).toEqual([
      'bun test exited 1',
    ]);
  });

  it('names a skipped test, which is how a missing database env looks', () => {
    const problems = invocationProblems(0, BUN_OUTPUT_THREE_FILES, [
      'a.test.ts',
      'b.test.ts',
      'empty.test.ts',
    ]);
    expect(problems.some((problem) => problem.includes('1 test(s) skipped'))).toBe(true);
  });

  it('flags a file that is in the invocation but has no passing test, even when bun counts it as run', () => {
    // bun reports "across 3 files" including the empty one, so the count alone would pass.
    expect(
      invocationProblems(0, BUN_OUTPUT_THREE_FILES, ['a.test.ts', 'b.test.ts', 'empty.test.ts']),
    ).toEqual([
      '1 test(s) skipped (the database env did not reach the tests)',
      'empty.test.ts has no passing test',
    ]);
  });

  it('flags a file bun did not run at all', () => {
    expect(invocationProblems(0, BUN_OUTPUT_ONE_FILE, ['a.test.ts', 'missing.test.ts'])).toEqual([
      'missing.test.ts has no passing test',
      'bun ran 1 file(s), expected 2',
    ]);
  });
});

describe('invocationsFor', () => {
  it('keeps the shared process whole and gives every other suite its own process', () => {
    const discovered = [
      'src/routes/v1/__tests__/sheet-feature-rest.real-db.test.ts',
      'src/services/__tests__/attack-telemetry.real-db.test.ts',
      'src/services/__tests__/brand-new.real-db.test.ts',
    ];
    expect(invocationsFor(discovered)).toEqual([
      [
        'src/services/__tests__/attack-telemetry.real-db.test.ts',
        'src/services/__tests__/insert-select-writes-land.test.ts',
        'src/services/__tests__/combat-damage-log-resilience.test.ts',
        'src/services/combat/__tests__/campaign-monster-resolution.pg.test.ts',
      ],
      ['src/routes/v1/__tests__/sheet-feature-rest.real-db.test.ts'],
      ['src/services/__tests__/brand-new.real-db.test.ts'],
    ]);
  });

  it('runs the whole shared process as one invocation when every member is discovered', () => {
    const discovered = SHARED_PROCESS.filter((file) => file.endsWith('.real-db.test.ts'));
    expect(invocationsFor(discovered)).toEqual([SHARED_PROCESS]);
  });
});

describe('obsoleteExclusions', () => {
  it('names an excluded file that is no longer on disk', () => {
    const excluded = { 'src/gone.real-db.test.ts': 'blocked on #1' };
    expect(obsoleteExclusions(excluded, ['src/other.real-db.test.ts'])).toEqual([
      'src/gone.real-db.test.ts',
    ]);
  });

  it('is empty when every excluded file exists', () => {
    const excluded = { 'src/other.real-db.test.ts': 'blocked on #1' };
    expect(obsoleteExclusions(excluded, ['src/other.real-db.test.ts'])).toEqual([]);
  });
});

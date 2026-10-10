#!/usr/bin/env node
/**
 * Runs the server-bun real-database suites for the `server-real-db` job (#158).
 *
 * The suites are found by glob, so a new `*.real-db.test.ts` runs with no edit
 * to ci.yml. Deliberate exclusions are in real-db-known-unlisted.json, one
 * reason per file. An exclusion whose file no longer exists fails the job.
 *
 * Process sharing: SHARED_PROCESS is the one `bun test` process the job has
 * always used for its 26 files. Files in it depend on each other's process-wide
 * `mock.module` state, so it stays one process. Every other discovered suite
 * runs in its own process, which is the default for a new file (#1906, #1717).
 *
 * Guard, per file: bun prints a `<file>:` header for every file it loads and a
 * `(pass)` line under it for every passing test. A file with no passing test
 * (empty, or every test skipped) fails the job, and so does a skipped test, a
 * non-zero exit, or a set of files that differs from the glob's set. The
 * expected set is computed from the glob here, not from the invocation list.
 *
 * Run from ai-adventure-scribe-main: node scripts/ci/run-real-db-suites.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRealDbTests } from './check-real-db-test-list.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..', '..');
const SERVER_DIR = path.join(APP_DIR, 'server-bun');
const BASELINE_PATH = path.join(SCRIPT_DIR, 'real-db-known-unlisted.json');

// These three are not *.real-db.test.ts. The job has always run them, in the
// shared process, so they stay here rather than in ci.yml.
export const NON_REAL_DB_SUITES = [
  'src/services/__tests__/insert-select-writes-land.test.ts',
  'src/services/__tests__/combat-damage-log-resilience.test.ts',
  'src/services/combat/__tests__/campaign-monster-resolution.pg.test.ts',
];

export const SHARED_PROCESS = [
  'src/services/__tests__/attack-telemetry.real-db.test.ts',
  'src/services/__tests__/combat-hp-write-through.real-db.test.ts',
  'src/services/__tests__/encounter-ending-reason.real-db.test.ts',
  'src/services/__tests__/encounter-lifecycle.real-db.test.ts',
  'src/services/__tests__/idle-encounter-sweeper.real-db.test.ts',
  'src/services/__tests__/npc-turn-auto-advance.real-db.test.ts',
  'src/services/__tests__/turn-cycle-tolerance.real-db.test.ts',
  'src/services/__tests__/insert-select-writes-land.test.ts',
  'src/services/__tests__/combat-damage-log-resilience.test.ts',
  'src/services/__tests__/combat-initiative-modifier.real-db.test.ts',
  'src/services/__tests__/combat-pending-intent.real-db.test.ts',
  'src/services/__tests__/combat-intent-roster.real-db.test.ts',
  'src/services/__tests__/combat-entry-transcript.real-db.test.ts',
  'src/services/__tests__/combat-seat-player-name.real-db.test.ts',
  'src/services/__tests__/dying-and-death.real-db.test.ts',
  'src/services/combat/__tests__/campaign-monster-resolution.pg.test.ts',
  'src/services/__tests__/companions.real-db.test.ts',
  'src/services/__tests__/dm-reply-reconcile.real-db.test.ts',
  'src/services/__tests__/issue-1784-public-table-rls.real-db.test.ts',
  'src/services/__tests__/monster-attacks.real-db.test.ts',
  'src/services/__tests__/player-exit-intent.real-db.test.ts',
  'src/services/__tests__/session-initial-greeting.real-db.test.ts',
  'src/services/__tests__/session-init-once.real-db.test.ts',
  'src/services/__tests__/spell-slot-backfill.real-db.test.ts',
  'src/services/__tests__/spell-slot-single-source.real-db.test.ts',
  'src/services/__tests__/rest-long-rest-recovery.real-db.test.ts',
];

/**
 * The `bun test` invocations for the discovered, non-excluded suites: the shared
 * process first (only the members that exist), then one process per other suite.
 */
export function invocationsFor(discovered) {
  const shared = SHARED_PROCESS.filter(
    (file) => discovered.includes(file) || NON_REAL_DB_SUITES.includes(file),
  );
  const alone = discovered.filter((file) => !SHARED_PROCESS.includes(file)).map((file) => [file]);
  return [shared, ...alone];
}

/** Excluded entries whose file is gone: they would silently cover nothing. */
export function obsoleteExclusions(excluded, onDisk) {
  return Object.keys(excluded).filter((file) => !onDisk.includes(file));
}

/** Pass, fail, skip and file counts from bun's summary lines. */
export function readBunSummary(output) {
  const count = (label) => Number(output.match(new RegExp(`^\\s*(\\d+) ${label}$`, 'm'))?.[1] ?? 0);
  const files = Number(output.match(/^Ran \d+ tests? across (\d+) files?\./m)?.[1] ?? 0);
  return { pass: count('pass'), fail: count('fail'), skip: count('skip'), files };
}

/**
 * The files bun reported at least one passing test for. bun prints a `<file>:`
 * header per file, then that file's `(pass)`/`(skip)`/`(fail)` lines.
 */
export function filesWithPassingTests(output) {
  const passing = new Set();
  let current = null;
  for (const line of output.split('\n')) {
    const header = line.match(/^(\S+\.test\.ts):$/);
    if (header) {
      current = header[1];
    } else if (current !== null && line.startsWith('(pass)')) {
      passing.add(current);
    }
  }
  return passing;
}

/** Problems that stop an invocation from counting as run. Empty when it ran clean. */
export function invocationProblems(exitCode, output, files) {
  if (exitCode !== 0) return [`bun test exited ${exitCode}`];
  const summary = readBunSummary(output);
  const problems = [];
  if (summary.skip > 0) {
    problems.push(`${summary.skip} test(s) skipped (the database env did not reach the tests)`);
  }
  const passing = filesWithPassingTests(output);
  for (const file of files) {
    if (!passing.has(file)) problems.push(`${file} has no passing test`);
  }
  if (summary.files !== files.length) {
    problems.push(`bun ran ${summary.files} file(s), expected ${files.length}`);
  }
  return problems;
}

function runInvocation(files) {
  const result = spawnSync('bun', ['test', ...files], {
    cwd: SERVER_DIR,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    return { files, passing: new Set(), problems: [`could not start bun: ${result.error.message}`] };
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return {
    files,
    passing: filesWithPassingTests(output),
    problems: invocationProblems(result.status, output, files),
  };
}

function main() {
  const onDisk = collectRealDbTests();
  if (onDisk.length === 0) {
    console.error('::error::no *.real-db.test.ts found under server-bun/src -- the glob found nothing to run.');
    process.exit(1);
  }
  const excluded = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const obsolete = obsoleteExclusions(excluded, onDisk);
  if (obsolete.length > 0) {
    for (const file of obsolete) {
      console.error(
        `::error::real-db-known-unlisted.json excludes ${file}, which no longer exists. Delete the entry.`,
      );
    }
    process.exit(1);
  }

  const missing = [...SHARED_PROCESS, ...NON_REAL_DB_SUITES].filter(
    (file) => !existsSync(path.join(SERVER_DIR, file)),
  );
  if (missing.length > 0) {
    console.error(`::error::SHARED_PROCESS names file(s) that do not exist: ${missing.join(', ')}`);
    process.exit(1);
  }

  const discovered = onDisk.filter((file) => !(file in excluded));
  const expected = [...discovered, ...NON_REAL_DB_SUITES];
  const invocations = invocationsFor(discovered);
  const planned = invocations.flat().sort().join('\n');
  if (planned !== [...expected].sort().join('\n')) {
    console.error('::error::the bun test invocations do not cover exactly the expected suite files.');
    process.exit(1);
  }

  console.log(
    `Real-DB suites found: ${onDisk.length}; excluded: ${onDisk.length - discovered.length}; ` +
      `to run: ${discovered.length} real-DB + ${NON_REAL_DB_SUITES.length} other, in ${invocations.length} bun test process(es).`,
  );
  for (const file of onDisk.filter((file) => file in excluded)) {
    console.log(`  excluded: ${file} -- ${excluded[file]}`);
  }

  const runs = invocations.map((files) => {
    console.log(`\n=== bun test (${files.length} file${files.length === 1 ? '' : 's'}): ${files.join(' ')}`);
    return runInvocation(files);
  });

  for (const run of runs) {
    for (const problem of run.problems) {
      console.error(`::error::${problem}`);
    }
  }
  const passed = new Set(runs.flatMap((run) => (run.problems.length === 0 ? [...run.passing] : [])));
  const missing_ = expected.filter((file) => !passed.has(file));
  console.log(`\nReal-DB suite files that ran clean: ${expected.length - missing_.length} of ${expected.length}.`);
  if (missing_.length > 0 || runs.some((run) => run.problems.length > 0)) {
    for (const file of missing_) {
      console.error(`::error::${file} did not run clean`);
    }
    console.error('::error::The job fails rather than report a partial run.');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

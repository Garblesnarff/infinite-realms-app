#!/usr/bin/env node
/**
 * Runs the server-bun real-database suites for the `server-real-db` job (#158).
 *
 * The suites are found by glob, so a new `*.real-db.test.ts` runs with no edit
 * to ci.yml. Deliberate exclusions are in real-db-known-unlisted.json, one
 * reason per file. An exclusion whose file no longer exists fails the job.
 *
 * Process sharing: SHARED_PROCESS is the one `bun test` process the job has
 * always used for its files. Files in it depend on each other's process-wide
 * `mock.module` state, so it stays one process. Every other discovered suite
 * runs in its own process, which is the default for a new file (#1906, #1717).
 *
 * OWN_PROCESS_LOCK_SUITES used to sit in that shared process. They take row
 * locks on dialogue_history or characters. A lock_timeout there exits bun for
 * every file in the process, and the old process.exit dropped the buffered
 * failure. Each of them now runs alone (#852).
 *
 * Guard, per file: bun prints a `<file>:` header for every file it loads and a
 * `(pass)` line under it for every passing test. A file with no passing test
 * (empty, or every test skipped) fails the job, and so does a skipped test, a
 * non-zero exit, or a set of files that differs from the glob's set. The
 * expected set is computed from the glob here, not from the invocation list.
 *
 * Run from ai-adventure-scribe-main: node scripts/ci/run-real-db-suites.mjs
 */
import { existsSync, readFileSync, writeSync } from 'node:fs';
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
  'src/services/__tests__/issue-1784-public-table-rls.real-db.test.ts',
  'src/services/__tests__/monster-attacks.real-db.test.ts',
  'src/services/__tests__/player-exit-intent.real-db.test.ts',
  'src/services/__tests__/rest-long-rest-recovery.real-db.test.ts',
];

/**
 * Row locks on dialogue_history or characters. A timeout in the shared
 * process used to fail every file in that process (#852). Own process each.
 * `invocationsFor` already gives any file outside SHARED_PROCESS its own
 * `bun test`, one after another.
 */
export const OWN_PROCESS_LOCK_SUITES = [
  'src/services/__tests__/dm-reply-reconcile.real-db.test.ts',
  'src/services/__tests__/session-initial-greeting.real-db.test.ts',
  'src/services/__tests__/session-init-once.real-db.test.ts',
  'src/services/__tests__/spell-slot-backfill.real-db.test.ts',
  'src/services/__tests__/spell-slot-single-source.real-db.test.ts',
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
const FILE_HEADER = /^(?:##\[group\]|::group::)?(\S+\.test\.ts):$/;
const FAIL_LINE = /^\(fail\)\s+(.+?)(?:\s+\[\d+(?:\.\d+)?ms\])?\s*$/;

export function filesWithPassingTests(output) {
  const passing = new Set();
  let current = null;
  for (const line of output.split('\n')) {
    // GitHub Actions turns each header into a log group (bun 1.4 on the hosted runner).
    const header = line.match(FILE_HEADER);
    if (header) {
      current = header[1];
    } else if (current !== null && line.startsWith('(pass)')) {
      passing.add(current);
    }
  }
  return passing;
}

/**
 * One line per file. A non-zero exit with no `(fail)` line blames the last
 * file bun had started, not every file that already passed (#852).
 */
export function fileVerdicts(files, output, exitCode) {
  const fails = new Map();
  let current = null;
  let lastHeader = null;
  for (const line of output.split('\n')) {
    const header = line.match(FILE_HEADER);
    if (header) {
      current = header[1];
      if (files.includes(current)) lastHeader = current;
      continue;
    }
    const fail = line.match(FAIL_LINE);
    if (!fail) continue;
    const file = current && files.includes(current) ? current : files[0];
    const names = fails.get(file) ?? [];
    names.push(fail[1]);
    fails.set(file, names);
  }
  const lines = output.split('\n').map((line) => line.trim());
  // Prefer bun's `error:` line. A passing test whose name mentions a lock
  // must not become the reason (#852).
  const errorLine =
    lines.find((line) => line.startsWith('error:')) ??
    lines.find((line) => line.includes('canceling statement due to lock timeout'));
  const blamed = new Set(fails.keys());
  if (exitCode !== 0 && blamed.size === 0) {
    blamed.add(lastHeader ?? files[files.length - 1]);
  }
  const passing = filesWithPassingTests(output);
  return files.map((file) => {
    const names = fails.get(file) ?? [];
    if (names.length > 0) return `real-db-file fail ${file} :: ${names.join(' | ')}`;
    if (blamed.has(file)) {
      const why = errorLine ?? `bun test exited ${exitCode}`;
      return `real-db-file fail ${file} :: ${why}`;
    }
    if (!passing.has(file)) return `real-db-file fail ${file} :: no passing test`;
    return `real-db-file pass ${file}`;
  });
}

/** Problems that stop an invocation from counting as run. Empty when it ran clean. */
export function invocationProblems(exitCode, output, files) {
  const problems = [];
  if (exitCode !== 0) problems.push(`bun test exited ${exitCode}`);
  for (const verdict of fileVerdicts(files, output, exitCode)) {
    if (verdict.includes(' fail ')) problems.push(verdict);
  }
  if (exitCode !== 0) return problems;
  const summary = readBunSummary(output);
  if (summary.skip > 0) {
    problems.push(`${summary.skip} test(s) skipped (the database env did not reach the tests)`);
  }
  if (summary.files !== files.length) {
    problems.push(`bun ran ${summary.files} file(s), expected ${files.length}`);
  }
  return problems;
}

function emit(text) {
  writeSync(1, text.endsWith('\n') ? text : `${text}\n`);
}

function emitError(text) {
  writeSync(2, text.endsWith('\n') ? text : `${text}\n`);
}

function runInvocation(files) {
  // --no-orphans kills bun's descendants on exit, so a crashed file cannot
  // keep a row lock into the next process (#852). bun 1.4.3 accepts the flag:
  // `bun test --no-orphans src/lib/__tests__/rng.test.ts` from server-bun
  // printed "10 pass" and "0 fail".
  const result = spawnSync('bun', ['test', '--no-orphans', ...files], {
    cwd: SERVER_DIR,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    const reason = `could not start bun: ${result.error.message}`;
    const problems = [reason];
    for (const file of files) {
      const verdict = `real-db-file fail ${file} :: ${reason}`;
      emit(verdict);
      problems.push(verdict);
    }
    return { files, passing: new Set(), problems };
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // writeSync, not stdout.write: process.exit drops a buffered stream, which
  // is how a lock timeout used to hide the failing test (#852).
  if (output) emit(output);
  const exitCode = result.status ?? 1;
  const verdicts = fileVerdicts(files, output, exitCode);
  for (const verdict of verdicts) emit(verdict);
  const passing = new Set(
    files.filter((file) => verdicts.includes(`real-db-file pass ${file}`)),
  );
  return {
    files,
    passing,
    problems: invocationProblems(exitCode, output, files),
  };
}

function main() {
  const onDisk = collectRealDbTests();
  if (onDisk.length === 0) {
    emitError(
      '::error::no *.real-db.test.ts found under server-bun/src -- the glob found nothing to run.',
    );
    process.exit(1);
  }
  const excluded = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const obsolete = obsoleteExclusions(excluded, onDisk);
  if (obsolete.length > 0) {
    for (const file of obsolete) {
      emitError(
        `::error::real-db-known-unlisted.json excludes ${file}, which no longer exists. Delete the entry.`,
      );
    }
    process.exit(1);
  }

  const mustExist = [...SHARED_PROCESS, ...NON_REAL_DB_SUITES, ...OWN_PROCESS_LOCK_SUITES];
  const missing = mustExist.filter((file) => !existsSync(path.join(SERVER_DIR, file)));
  if (missing.length > 0) {
    emitError(`::error::a named real-db suite does not exist: ${missing.join(', ')}`);
    process.exit(1);
  }

  const discovered = onDisk.filter((file) => !(file in excluded));
  const expected = [...discovered, ...NON_REAL_DB_SUITES];
  const invocations = invocationsFor(discovered);
  const planned = invocations.flat().sort().join('\n');
  if (planned !== [...expected].sort().join('\n')) {
    emitError('::error::the bun test invocations do not cover exactly the expected suite files.');
    process.exit(1);
  }

  emit(
    `Real-DB suites found: ${onDisk.length}; excluded: ${onDisk.length - discovered.length}; ` +
      `to run: ${discovered.length} real-DB + ${NON_REAL_DB_SUITES.length} other, in ${invocations.length} bun test process(es).`,
  );
  for (const file of onDisk.filter((file) => file in excluded)) {
    emit(`  excluded: ${file} -- ${excluded[file]}`);
  }

  const runs = invocations.map((files) => {
    emit(
      `\n=== bun test (${files.length} file${files.length === 1 ? '' : 's'}): ${files.join(' ')}`,
    );
    return runInvocation(files);
  });

  for (const run of runs) {
    for (const problem of run.problems) {
      emitError(`::error::${problem}`);
    }
  }
  const passed = new Set(runs.flatMap((run) => [...run.passing]));
  const missing_ = expected.filter((file) => !passed.has(file));
  emit(
    `\nReal-DB suite files that ran clean: ${expected.length - missing_.length} of ${expected.length}.`,
  );
  if (missing_.length > 0 || runs.some((run) => run.problems.length > 0)) {
    for (const file of missing_) {
      emitError(`::error::${file} did not run clean`);
    }
    emitError('::error::The job fails rather than report a partial run.');
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

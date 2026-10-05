#!/usr/bin/env node
/**
 * Guard: every server-bun `*.real-db.test.ts` must appear in the explicit file
 * list of the `server-real-db` job in .github/workflows/ci.yml (#2574).
 *
 * The list stays a list -- a whole-suite `bun test` with a database configured
 * fails 54 tests (see the comment in ci.yml), so it cannot become a glob. What
 * this script removes is the excuse that forgetting to register a new suite is
 * invisible: a new real-DB test file that nobody added to the list runs nowhere,
 * and `server-vitest` reports a green suite that degraded to `describe.skip`.
 * That is the #1906 trap (#2560 hit it again).
 *
 * Known-unlisted files live in real-db-known-unlisted.json, one reason each, so
 * the already-unlisted suites are a visible backlog rather than a silent one.
 * An entry that becomes listed (or whose file is deleted) fails as obsolete, so
 * the baseline cannot rot -- the same rule server-typecheck-gate.sh applies.
 *
 * Run: node scripts/ci/check-real-db-test-list.mjs   (exit 1 on any difference)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');
const SERVER_SRC = path.join(APP_DIR, 'server-bun', 'src');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const BASELINE_PATH = path.join(SCRIPT_DIR, 'real-db-known-unlisted.json');

const REAL_DB_SUFFIX = '.real-db.test.ts';
const LISTED_PATH = /(?<=^|\s)src\/[\w./-]+\.real-db\.test\.ts(?=\s|\\|$)/g;
const JOB_KEY = /^(\s*)server-real-db:\s*$/;

/**
 * Every real-DB test file under server-bun/src, as `src/...` paths relative to
 * server-bun -- the same shape the ci.yml list uses, since its `bun test` step
 * runs with server-bun as the working directory.
 */
export function collectRealDbTests(dir = SERVER_SRC, prefix = 'src') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Skip dotfiles: macOS writes `._foo.real-db.test.ts` AppleDouble sidecars
    // next to the real file on exFAT checkouts, and they are not test files.
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...collectRealDbTests(path.join(dir, entry.name), relative));
    } else if (entry.name.endsWith(REAL_DB_SUFFIX)) {
      found.push(relative);
    }
  }
  return found.sort();
}

/**
 * The real-DB entries of the `server-real-db` job's `bun test` invocations.
 *
 * Scoped to that job on purpose. The workflow has several `run:` blocks and this
 * file adds one of its own, so "the first `bun test` in the file" would let an
 * unrelated step above become the list the guard compares against -- a suite
 * removed from server-real-db would then read as registered. Every `bun test`
 * in the job is read, so splitting the list across two invocations stays valid,
 * and a path commented out inside the block is not a registration.
 */
export function parseListedRealDbTests(workflowYaml) {
  const lines = workflowYaml.split('\n');
  const jobStart = lines.findIndex((line) => JOB_KEY.test(line));
  if (jobStart === -1) {
    throw new Error(`no server-real-db job found in ${WORKFLOW_PATH}`);
  }
  const jobIndent = lines[jobStart].match(JOB_KEY)[1].length;
  let jobEnd = lines.length;
  for (let index = jobStart + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (line.length - line.trimStart().length <= jobIndent) {
      jobEnd = index;
      break;
    }
  }
  const jobLines = lines.slice(jobStart, jobEnd);

  const listed = [];
  for (const [index, line] of jobLines.entries()) {
    if (!/^\s*bun test\s*\\?\s*$/.test(line)) continue;
    const commandIndent = line.length - line.trimStart().length;
    for (const continuation of jobLines.slice(index + 1)) {
      if (continuation.trim() === '') continue;
      if (continuation.length - continuation.trimStart().length <= commandIndent) break;
      if (continuation.trimStart().startsWith('#')) continue;
      listed.push(...(continuation.match(LISTED_PATH) ?? []));
    }
  }
  if (listed.length === 0) {
    throw new Error(
      `the server-real-db job in ${WORKFLOW_PATH} lists no *.real-db.test.ts file to compare against`,
    );
  }
  return listed;
}

/**
 * Compares what is on disk, what the workflow lists, and the known-unlisted
 * baseline. Returns the three sets that must not drift apart.
 *
 * @param {string[]} onDisk - paths from collectRealDbTests
 * @param {string[]} listed - paths from parseListedRealDbTests
 * @param {Record<string, string>} knownUnlisted - path -> reason
 */
export function compareRealDbLists(onDisk, listed, knownUnlisted = {}) {
  const listedSet = new Set(listed);
  const onDiskSet = new Set(onDisk);
  return {
    unlisted: onDisk.filter((file) => !listedSet.has(file) && !(file in knownUnlisted)),
    stale: listed.filter((file) => !onDiskSet.has(file)),
    obsoleteBaseline: Object.keys(knownUnlisted).filter(
      (file) => listedSet.has(file) || !onDiskSet.has(file),
    ),
  };
}

function main() {
  const knownUnlisted = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const onDisk = collectRealDbTests();
  const result = compareRealDbLists(
    onDisk,
    parseListedRealDbTests(readFileSync(WORKFLOW_PATH, 'utf8')),
    knownUnlisted,
  );
  const backlog = Object.keys(knownUnlisted);

  for (const file of result.unlisted) {
    console.error(
      `::error::${file} is a real-DB test but is not in the server-real-db file list in ci.yml, so it never runs. Add it there, or record it in ${path.basename(BASELINE_PATH)} with the reason it cannot run yet.`,
    );
  }
  for (const file of result.stale) {
    console.error(
      `::error::ci.yml lists ${file}, which does not exist. Remove the entry or restore the file.`,
    );
  }
  for (const file of result.obsoleteBaseline) {
    console.error(
      `::error::${path.basename(BASELINE_PATH)} records ${file}, which is now listed in ci.yml or no longer exists. Delete the entry.`,
    );
  }
  if (backlog.length > 0) {
    console.log(
      `Known-unlisted real-DB suites still not in the ci.yml list (${backlog.length}):\n${backlog.map((file) => `  - ${file} — ${knownUnlisted[file]}`).join('\n')}`,
    );
  }

  if (result.unlisted.length + result.stale.length + result.obsoleteBaseline.length > 0) {
    process.exit(1);
  }
  console.log(
    `Real-DB test list matches: ${onDisk.length} suite(s) on disk, all listed in ci.yml.`,
  );
}

// Only run the check when invoked directly; the unit test imports the functions.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
#!/usr/bin/env node
/**
 * Guard: every server-bun `*.test.ts` / `*.vitest.ts` is executed by a CI job
 * (#2602). The real-DB list guard only sees `*.real-db.test.ts`. A file outside
 * the isolated runner's glob, outside server-bun's vitest include, and absent
 * from the `server-real-db` file list runs nowhere, and both jobs stay green.
 *
 * `*.real-db.test.ts` matches the isolated glob but does not count as run by
 * it: `server-vitest` sets no database, so `describeWithDb` skips the file
 * (#1906). The `server-real-db` job runs the glob from run-real-db-suites.mjs
 * (#158), and the known-unlisted baseline excludes the rest, so those count.
 *
 * Run: node scripts/ci/check-server-tests-run.mjs   (exit 1 when any file is unrun)
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRealDbTests } from './check-real-db-test-list.mjs';
import { NON_REAL_DB_SUITES } from './run-real-db-suites.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(APP_DIR, '..');
const SERVER_DIR = path.join(APP_DIR, 'server-bun');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const BASELINE_PATH = path.join(SCRIPT_DIR, 'real-db-known-unlisted.json');
const ISOLATED_RUNNER_PATH = path.join(SERVER_DIR, 'scripts', 'run-isolated-tests.ts');
const VITEST_CONFIG_PATH = path.join(SERVER_DIR, 'vitest.config.ts');
const SERVER_PACKAGE_PATH = path.join(SERVER_DIR, 'package.json');

const JOB_KEY = (name) => new RegExp(`^(\\s*)${name}:\\s*$`);
const TEST_PATH = /(?<=^|\s)[\w./-]+\.(?:vitest\.ts|test\.ts)(?=\s|\\|$)/g;
const SIMPLE_GLOB = /^(.+)\/\*\*\/\*(.+)$/;

export function sliceJob(workflowYaml, jobName) {
  const lines = workflowYaml.split('\n');
  const key = JOB_KEY(jobName);
  const jobStart = lines.findIndex((line) => key.test(line));
  if (jobStart === -1) {
    throw new Error(`no ${jobName} job found in ${WORKFLOW_PATH}`);
  }
  const jobIndent = lines[jobStart].match(key)[1].length;
  let jobEnd = lines.length;
  for (let index = jobStart + 1; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (line.length - line.trimStart().length <= jobIndent) {
      jobEnd = index;
      break;
    }
  }
  return lines.slice(jobStart, jobEnd);
}

/**
 * Test-file arguments of every `bun test` invocation in one job. Comment lines
 * inside the command block are not registrations. A path outside that job is
 * not a registration either: the checks job runs this file's own unit test.
 */
export function parseBunTestPaths(jobLines) {
  const listed = [];
  for (const [index, line] of jobLines.entries()) {
    if (!/^\s*bun test\s*\\?\s*$/.test(line)) continue;
    const commandIndent = line.length - line.trimStart().length;
    for (const continuation of jobLines.slice(index + 1)) {
      if (continuation.trim() === '') continue;
      if (continuation.length - continuation.trimStart().length <= commandIndent) break;
      if (continuation.trimStart().startsWith('#')) continue;
      listed.push(...(continuation.match(TEST_PATH) ?? []));
    }
  }
  return listed;
}

export function parseIsolatedGlob(runnerSource) {
  const match = runnerSource.match(/new Bun\.Glob\(\s*['"]([^'"]+)['"]\s*\)/);
  if (!match) {
    throw new Error(`${ISOLATED_RUNNER_PATH} has no Bun.Glob('...') for the isolated suite`);
  }
  return match[1];
}

export function parseVitestConfig(configSource) {
  const includeBlock = configSource.match(/include:\s*\[([^\]]*)\]/);
  if (!includeBlock) {
    throw new Error(`${VITEST_CONFIG_PATH} has no test.include`);
  }
  const include = [...includeBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  if (include.length === 0) {
    throw new Error(`${VITEST_CONFIG_PATH} test.include is empty`);
  }
  const excludeBlock = configSource.match(/exclude:\s*\[([^\]]*)\]/);
  const exclude = excludeBlock
    ? [...excludeBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1])
    : [];
  return { include, exclude };
}

export function serverVitestInvokes(jobLines) {
  const commands = jobLines
    .filter((line) => !line.trimStart().startsWith('#'))
    .map((line) => line.trim());
  return {
    isolated: commands.some((line) => /^-?\s*run:\s*bun run test$/.test(line)),
    vitest: commands.some((line) => /bun run test:vitest\b/.test(line)),
  };
}

export function assertPackageScripts(packageJson) {
  const scripts = JSON.parse(packageJson).scripts ?? {};
  if (!String(scripts.test ?? '').includes('run-isolated-tests.ts')) {
    throw new Error(
      'server-bun package.json script "test" does not run scripts/run-isolated-tests.ts',
    );
  }
  if (!String(scripts['test:vitest'] ?? '').includes('vitest')) {
    throw new Error('server-bun package.json script "test:vitest" does not run vitest');
  }
}

export function matchSimpleGlob(file, glob) {
  const parsed = glob.match(SIMPLE_GLOB);
  if (!parsed) {
    throw new Error(
      `unsupported CI test glob "${glob}" — this check only understands dir/**/*suffix`,
    );
  }
  const [, dir, suffix] = parsed;
  if (file.split('/').some((segment) => segment.startsWith('.'))) return false;
  return file.startsWith(`${dir}/`) && file.endsWith(suffix);
}

/**
 * @param {string[]} onDisk paths relative to server-bun
 * @param {string[]} explicitPaths paths named in the server-real-db job
 */
export function compareServerTestsRun({
  onDisk,
  isolatedGlob,
  isolatedRunnerExecuted,
  vitestIncludes,
  vitestExecuted,
  explicitPaths,
  skippedWithoutDb = [],
  knownUnlisted = {},
}) {
  const skipped = new Set(skippedWithoutDb);
  const covered = new Set(explicitPaths);
  for (const file of onDisk) {
    if (vitestExecuted && vitestIncludes.some((glob) => matchSimpleGlob(file, glob))) {
      covered.add(file);
    }
    // describeWithDb skips the whole file when server-vitest has no database
    // (#1906). The isolated glob still matches those files. Only the
    // server-real-db list (or the known-unlisted baseline) counts as a run.
    if (
      isolatedRunnerExecuted &&
      !file.endsWith('.real-db.test.ts') &&
      !skipped.has(file) &&
      matchSimpleGlob(file, isolatedGlob)
    ) {
      covered.add(file);
    }
  }
  return {
    unrun: onDisk.filter((file) => !covered.has(file) && !(file in knownUnlisted)).sort(),
  };
}

/** True when the file's tests are `describeWithDb`, which skips with no database. */
export function usesDescribeWithDb(source) {
  return /\bdescribeWithDb\s*\(/.test(source);
}

export function collectServerTestFiles(dir = SERVER_DIR, prefix = '') {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // node_modules is not a project test tree. The checks job runs this script
    // before bun install, but a local run happens after, and a dependency file
    // named *.test.ts is not a suite any CI job is supposed to execute.
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...collectServerTestFiles(path.join(dir, entry.name), relative));
    } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.vitest.ts')) {
      found.push(relative);
    }
  }
  return found.sort();
}

function main() {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  assertPackageScripts(readFileSync(SERVER_PACKAGE_PATH, 'utf8'));

  const isolatedGlob = parseIsolatedGlob(readFileSync(ISOLATED_RUNNER_PATH, 'utf8'));
  const { include, exclude } = parseVitestConfig(readFileSync(VITEST_CONFIG_PATH, 'utf8'));
  const unexpectedExclude = exclude.filter((glob) => glob !== '**/._*');
  if (unexpectedExclude.length > 0) {
    throw new Error(
      `${VITEST_CONFIG_PATH} exclude has patterns this check does not apply: ${unexpectedExclude.join(', ')}`,
    );
  }

  const invoked = serverVitestInvokes(sliceJob(workflow, 'server-vitest'));
  if (!invoked.isolated || !invoked.vitest) {
    throw new Error(
      'the server-vitest job does not run both `bun run test` and `bun run test:vitest`',
    );
  }

  const knownUnlisted = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const onDisk = collectServerTestFiles();
  const result = compareServerTestsRun({
    onDisk,
    isolatedGlob,
    isolatedRunnerExecuted: true,
    vitestIncludes: include,
    vitestExecuted: true,
    explicitPaths: [
      ...parseBunTestPaths(sliceJob(workflow, 'server-real-db')),
      ...collectRealDbTests().filter((file) => !(file in knownUnlisted)),
      ...NON_REAL_DB_SUITES,
    ],
    skippedWithoutDb: onDisk.filter((file) =>
      usesDescribeWithDb(readFileSync(path.join(SERVER_DIR, file), 'utf8')),
    ),
    knownUnlisted,
  });

  for (const file of result.unrun) {
    console.error(
      `::error::${file} is a server-bun test file that no CI job runs. ` +
        `A *.real-db.test.ts file, or any file that uses describeWithDb, counts only when ` +
        `the server-real-db list names it (the isolated suite skips it). Other *.test.ts files ` +
        `must match the isolated glob (${isolatedGlob}); *.vitest.ts files must match ` +
        `server-bun vitest include (${include.join(', ')}).`,
    );
  }
  if (result.unrun.length > 0) process.exit(1);
  console.log('Server test discovery matches: every server-bun test file is run by a CI job.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

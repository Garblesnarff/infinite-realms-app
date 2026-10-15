/**
 * Run each Bun test file in its own process.
 *
 * Bun's mock.module() registry is process-wide. A file-level --isolate run
 * therefore does not prevent a top-level mock from changing the module graph
 * seen by a later file in the same invocation. Fresh child processes preserve
 * the existing test set while keeping those file-local module replacements
 * local to the file that declared them.
 */
/* eslint-disable no-console */

import { isAppleDoubleSidecar } from './apple-double.ts';

type TestCounts = {
  pass: number;
  skip: number;
  fail: number;
  error: number;
  tests: number;
  files: number;
};

const emptyCounts = (): TestCounts => ({
  pass: 0,
  skip: 0,
  fail: 0,
  error: 0,
  tests: 0,
  files: 0,
});

const decoder = new TextDecoder();

function decode(value: Uint8Array | string | undefined): string {
  if (typeof value === 'string') return value;
  return value ? decoder.decode(value) : '';
}

function lastCount(output: string, label: string): number {
  const matches = [...output.matchAll(new RegExp(`(\\d+) ${label}\\b`, 'g'))];
  return Number(matches.at(-1)?.[1] ?? 0);
}

function parseCounts(output: string): TestCounts {
  const summary = output.match(/Ran (\d+) tests? across (\d+) files?/);
  return {
    pass: lastCount(output, 'pass'),
    skip: lastCount(output, 'skip'),
    fail: lastCount(output, 'fail'),
    error: lastCount(output, 'error'),
    tests: Number(summary?.[1] ?? 0),
    files: Number(summary?.[2] ?? 0),
  };
}

const files = Array.from(new Bun.Glob('src/**/*.test.ts').scanSync({ cwd: process.cwd() }))
  .filter((file) => !isAppleDoubleSidecar(file))
  .sort();

if (files.length === 0) {
  throw new Error('server-vitest isolated runner found no src/**/*.test.ts files');
}

const total = emptyCounts();
const failures: Array<{ file: string; output: string }> = [];

// Each file still gets its own process (the whole point of this runner), but
// several processes can run at once: the isolation is per process, so running
// four of them side by side changes nothing about what each one sees.
// ISOLATED_TEST_CONCURRENCY sets the width; the default is 1, the old serial
// behaviour, so a local run is unchanged unless asked. CI sets 4 (the hosted
// runner has 4 cores) and cut the step from ~32s to ~10s.
const parsedConcurrency = Number.parseInt(process.env.ISOLATED_TEST_CONCURRENCY ?? '1', 10);
const concurrency = Number.isFinite(parsedConcurrency) && parsedConcurrency > 0 ? parsedConcurrency : 1;

async function runFile(file: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: [process.execPath, 'test', '--isolate', file],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = `${decode(stdout)}${decode(stderr)}`;
  const counts = parseCounts(output);

  total.pass += counts.pass;
  total.skip += counts.skip;
  total.fail += counts.fail;
  total.error += counts.error;
  total.tests += counts.tests;
  total.files += counts.files;

  const hasUnhandledError = /Unhandled error(?: between tests)?|error between tests/i.test(output);
  if (exitCode !== 0 || counts.fail > 0 || counts.error > 0 || hasUnhandledError) {
    failures.push({ file, output });
  }
}

// A bounded pool: `concurrency` workers each pull the next file off one shared
// queue until it is empty. Results are summed as they finish; the failure list
// is printed at the end in whatever order the files completed.
const queue = [...files];
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await runFile(next);
    }
  }),
);

failures.sort((a, b) => a.file.localeCompare(b.file));

console.log('server-vitest fresh-process runner');
console.log(`Ran ${total.tests} tests across ${total.files} files.`);
console.log(`${total.pass} pass`);
console.log(`${total.skip} skip`);
console.log(`${total.fail} fail`);
console.log(`${total.error} error`);

if (failures.length > 0) {
  console.error(`\n${failures.length} test file(s) failed:`);
  for (const failure of failures) {
    console.error(`\n--- ${failure.file} ---\n${failure.output.trim()}`);
  }
  process.exitCode = 1;
}

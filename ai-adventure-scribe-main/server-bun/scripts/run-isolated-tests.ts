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

const files = Array.from(new Bun.Glob('src/**/*.test.ts').scanSync({ cwd: process.cwd() })).sort();

if (files.length === 0) {
  throw new Error('server-vitest isolated runner found no src/**/*.test.ts files');
}

const total = emptyCounts();
const failures: Array<{ file: string; output: string }> = [];

for (const file of files) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, 'test', '--isolate', file],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = `${decode(result.stdout)}${decode(result.stderr)}`;
  const counts = parseCounts(output);

  total.pass += counts.pass;
  total.skip += counts.skip;
  total.fail += counts.fail;
  total.error += counts.error;
  total.tests += counts.tests;
  total.files += counts.files;

  const hasUnhandledError = /Unhandled error(?: between tests)?|error between tests/i.test(output);
  if (result.exitCode !== 0 || counts.fail > 0 || counts.error > 0 || hasUnhandledError) {
    failures.push({ file, output });
  }
}

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

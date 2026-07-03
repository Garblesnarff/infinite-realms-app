#!/usr/bin/env node
// Gate: fail CI only on test failures that are NOT already in the known-failures
// baseline. Pre-existing failures (documented server-bun env-harness gaps and a
// handful of frontend tests) are allowed to keep failing until they're fixed
// deliberately; anything new failing is a real regression.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: check-vitest-baseline.mjs <vitest-json-report>');
  process.exit(1);
}

const cwd = process.cwd();
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const baselinePath = path.join(cwd, 'scripts/ci/known-failures.json');
const baseline = new Set(JSON.parse(readFileSync(baselinePath, 'utf8')));

const currentFailures = [];
for (const testFile of report.testResults ?? []) {
  const relFile = path.relative(cwd, testFile.name);
  for (const assertion of testFile.assertionResults ?? []) {
    if (assertion.status === 'failed') {
      currentFailures.push(`${relFile} :: ${assertion.fullName}`);
    }
  }
}

const newFailures = currentFailures.filter((f) => !baseline.has(f));
const fixed = [...baseline].filter((f) => !currentFailures.includes(f));

console.log(`Total failures: ${currentFailures.length} (baseline: ${baseline.size})`);

if (fixed.length > 0) {
  console.log(`\n${fixed.length} previously-known failure(s) now pass (consider removing from baseline):`);
  for (const f of fixed) console.log(`  - ${f}`);
}

if (newFailures.length > 0) {
  console.error(`\n${newFailures.length} NEW test failure(s) not in the known baseline:`);
  for (const f of newFailures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nNo new test failures vs baseline.');

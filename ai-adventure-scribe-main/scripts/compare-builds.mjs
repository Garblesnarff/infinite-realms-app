#!/usr/bin/env node
// Build-stability comparison for #55: two production builds whose commits differ
// only in server-bun/ must produce identical dist/assets/* names and content,
// except index.html (which embeds the per-build version stamp) and at most one
// dedicated version leaf chunk. This CLI FAILS CLOSED: missing, empty or
// non-build inputs exit non-zero, and any disallowed changed/added/removed
// asset exits non-zero.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const INDEX_HTML = 'index.html';
// A dedicated build-version leaf chunk, if the build emits one (#55 "at most one version leaf").
const VERSION_LEAF_PATTERN = /^assets\/version-[A-Za-z0-9]+\.js$/;

function hashFile(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getAllFiles(dir, rootDir = dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath, rootDir));
    } else if (entry.isFile()) {
      const relPath = path.relative(rootDir, fullPath);
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

function validateBuildDir(dir, label) {
  let stat = null;
  try {
    stat = fs.statSync(dir);
  } catch {
    stat = null;
  }
  if (!stat) throw new Error(`${label} '${dir}' does not exist`);
  if (!stat.isDirectory()) throw new Error(`${label} '${dir}' is not a directory`);
  const files = getAllFiles(dir);
  if (files.length === 0) throw new Error(`${label} '${dir}' is empty`);
  if (!files.some((f) => f.relPath === INDEX_HTML)) {
    throw new Error(`${label} '${dir}' has no ${INDEX_HTML}: not a build output directory`);
  }
  return files;
}

export function compareBuilds(dir1, dir2) {
  const files1 = getAllFiles(dir1);
  const files2 = getAllFiles(dir2);

  const map1 = new Map(files1.map((f) => [f.relPath, hashFile(f.fullPath)]));
  const map2 = new Map(files2.map((f) => [f.relPath, hashFile(f.fullPath)]));

  const identical = [];
  const changed = [];
  const onlyIn1 = [];
  const onlyIn2 = [];

  const allKeys = new Set([...map1.keys(), ...map2.keys()]);

  for (const key of allKeys) {
    const in1 = map1.has(key);
    const in2 = map2.has(key);

    if (in1 && in2) {
      if (map1.get(key) === map2.get(key)) {
        identical.push(key);
      } else {
        changed.push(key);
      }
    } else if (in1) {
      onlyIn1.push(key);
    } else {
      onlyIn2.push(key);
    }
  }

  return {
    dir1,
    dir2,
    counts: {
      total1: files1.length,
      total2: files2.length,
      identical: identical.length,
      changed: changed.length,
      onlyIn1: onlyIn1.length,
      onlyIn2: onlyIn2.length,
    },
    identical: identical.sort(),
    changed: changed.sort(),
    onlyIn1: onlyIn1.sort(),
    onlyIn2: onlyIn2.sort(),
  };
}

/**
 * Fail-closed stability assertion for #55. Throws on missing/empty/non-build
 * inputs; returns { ok, violations, versionLeaves, diff } where ok is false
 * when any changed/added/removed file is not the allowed index.html stamp or
 * the single allowed version leaf.
 */
export function assertStableServerOnlyPair(dir1, dir2) {
  validateBuildDir(dir1, 'dir1');
  validateBuildDir(dir2, 'dir2');
  const diff = compareBuilds(dir1, dir2);

  const violations = [];
  const versionLeaves = [];
  for (const relPath of [...diff.changed, ...diff.onlyIn1, ...diff.onlyIn2]) {
    if (relPath === INDEX_HTML) continue;
    if (VERSION_LEAF_PATTERN.test(relPath)) {
      versionLeaves.push(relPath);
      continue;
    }
    violations.push(relPath);
  }
  if (versionLeaves.length > 1) violations.push(...versionLeaves);

  return {
    ok: violations.length === 0,
    violations: violations.sort(),
    versionLeaves: versionLeaves.sort(),
    diff,
  };
}

function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const dirs = args.filter((arg) => !arg.startsWith('--'));

  if (dirs.length < 2) {
    console.error('Usage: compare-builds.mjs <dir1> <dir2> [--json]');
    process.exit(1);
  }

  let verdict;
  try {
    verdict = assertStableServerOnlyPair(dirs[0], dirs[1]);
  } catch (err) {
    console.error(`compare-builds: ${err.message}`);
    process.exit(1);
  }

  const { diff } = verdict;
  if (isJson) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(`Comparing build outputs:\n  Dir 1: ${dirs[0]}\n  Dir 2: ${dirs[1]}`);
    console.log(`\nSummary:`);
    console.log(`  Total files in Dir 1: ${diff.counts.total1}`);
    console.log(`  Total files in Dir 2: ${diff.counts.total2}`);
    console.log(`  Identical files:     ${diff.counts.identical}`);
    console.log(`  Changed content:     ${diff.counts.changed}`);
    console.log(`  Only in Dir 1:       ${diff.counts.onlyIn1}`);
    console.log(`  Only in Dir 2:       ${diff.counts.onlyIn2}`);

    if (diff.changed.length > 0) {
      console.log(`\nChanged files:`);
      for (const f of diff.changed) console.log(`  ~ ${f}`);
    }
    if (diff.onlyIn1.length > 0) {
      console.log(`\nFiles only in Dir 1:`);
      for (const f of diff.onlyIn1) console.log(`  - ${f}`);
    }
    if (diff.onlyIn2.length > 0) {
      console.log(`\nFiles only in Dir 2:`);
      for (const f of diff.onlyIn2) console.log(`  + ${f}`);
    }

    if (verdict.ok) {
      const allowed = [...diff.changed, ...diff.onlyIn1, ...diff.onlyIn2].filter(
        (f) => f === INDEX_HTML || VERSION_LEAF_PATTERN.test(f),
      );
      console.log(
        `\nSTABLE: no disallowed asset changes${allowed.length > 0 ? ` (allowed diffs: ${allowed.sort().join(', ')})` : ''}.`,
      );
    } else {
      console.log(`\nUNSTABLE: disallowed changes:`);
      for (const f of verdict.violations) console.log(`  ! ${f}`);
    }
  }

  process.exit(verdict.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

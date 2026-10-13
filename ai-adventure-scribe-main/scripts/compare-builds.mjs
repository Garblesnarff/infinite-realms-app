#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function hashFile(filepath) {
  const content = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getAllFiles(dir, rootDir = dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
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

function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const dirs = args.filter((arg) => !arg.startsWith('--'));

  if (dirs.length < 2) {
    console.error('Usage: compare-builds.mjs <dir1> <dir2> [--json]');
    process.exit(1);
  }

  const result = compareBuilds(dirs[0], dirs[1]);

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Comparing build outputs:\n  Dir 1: ${dirs[0]}\n  Dir 2: ${dirs[1]}`);
    console.log(`\nSummary:`);
    console.log(`  Total files in Dir 1: ${result.counts.total1}`);
    console.log(`  Total files in Dir 2: ${result.counts.total2}`);
    console.log(`  Identical files:     ${result.counts.identical}`);
    console.log(`  Changed content:     ${result.counts.changed}`);
    console.log(`  Only in Dir 1:       ${result.counts.onlyIn1}`);
    console.log(`  Only in Dir 2:       ${result.counts.onlyIn2}`);

    if (result.changed.length > 0) {
      console.log(`\nChanged files:`);
      for (const f of result.changed) console.log(`  ~ ${f}`);
    }
    if (result.onlyIn1.length > 0) {
      console.log(`\nFiles only in Dir 1:`);
      for (const f of result.onlyIn1) console.log(`  - ${f}`);
    }
    if (result.onlyIn2.length > 0) {
      console.log(`\nFiles only in Dir 2:`);
      for (const f of result.onlyIn2) console.log(`  + ${f}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

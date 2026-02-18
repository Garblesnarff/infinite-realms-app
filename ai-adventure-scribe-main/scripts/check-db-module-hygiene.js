#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();

const forbiddenDuplicateFileGlobs = [
  path.join('db'),
  path.join('src', 'infrastructure', 'database'),
];

const codeRoots = ['db', 'src', 'server-bun', 'tests', 'scripts'];
const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const forbiddenImportFragments = [
  'db/client.js',
  'db/schema/index.js',
  'src/infrastructure/database/index.js',
];

const scopedTsLocalJsImportChecks = [
  {
    root: path.join('db', 'schema'),
    ext: '.ts',
    pattern: /from\s+['"]\.\/[^'"]+\.js['"]/,
    message: 'TS schema files must not import local .js files',
  },
  {
    root: path.join('src', 'infrastructure', 'database'),
    ext: '.ts',
    pattern: /from\s+['"]\.\/[^'"]+\.js['"]/,
    message: 'TS infrastructure DB files must not import local .js files',
  },
];

function walk(dir, cb) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, cb);
    } else if (entry.isFile()) {
      cb(full);
    }
  }
}

const violations = [];
const selfPath = path.relative(repoRoot, new URL(import.meta.url).pathname).replace(/^\/+/, '');

// 1) No duplicate JS source files in the migrated module areas.
for (const relRoot of forbiddenDuplicateFileGlobs) {
  const absRoot = path.join(repoRoot, relRoot);
  walk(absRoot, (full) => {
    if (path.extname(full) === '.js') {
      violations.push({
        type: 'duplicate-js-file',
        file: path.relative(repoRoot, full),
        detail: 'Duplicate .js source file present in TS-only module area',
      });
    }
  });
}

// 2) No legacy .js import paths for canonical db module entrypoints.
for (const relRoot of codeRoots) {
  const absRoot = path.join(repoRoot, relRoot);
  walk(absRoot, (full) => {
    const ext = path.extname(full);
    if (!codeExtensions.has(ext)) return;
    const rel = path.relative(repoRoot, full);
    if (rel === selfPath) return;
    const source = fs.readFileSync(full, 'utf8');
    for (const fragment of forbiddenImportFragments) {
      if (source.includes(fragment)) {
        violations.push({
          type: 'legacy-import-path',
          file: rel,
          detail: `Contains legacy import path fragment: ${fragment}`,
        });
      }
    }
  });
}

// 3) In scoped TS folders, no local .js specifiers.
for (const rule of scopedTsLocalJsImportChecks) {
  const absRoot = path.join(repoRoot, rule.root);
  walk(absRoot, (full) => {
    if (path.extname(full) !== rule.ext) return;
    const rel = path.relative(repoRoot, full);
    const source = fs.readFileSync(full, 'utf8');
    if (rule.pattern.test(source)) {
      violations.push({
        type: 'scoped-local-js-import',
        file: rel,
        detail: rule.message,
      });
    }
  });
}

if (violations.length > 0) {
  console.error('DB/Infrastructure module hygiene check failed:\n');
  for (const v of violations) {
    console.error(`- [${v.type}] ${v.file}`);
    console.error(`  ${v.detail}`);
  }
  process.exit(1);
}

console.log('DB/Infrastructure module hygiene check passed.');

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #2525: the production client was POSTing to test-fixture encounters
 * (`/v1/combat/enc-2457/intent`, `/v1/combat/enc-m9/intent`, and earlier
 * `/v1/sessions/session-1/tactical-map`) on page load; every call 401'd.
 * Fixture ids belong in tests only — if one reaches production source it
 * ships in the bundle and fires against the live API. This guard walks the
 * production source tree (test files and `__tests__` directories excluded)
 * and fails on any `enc-*` encounter fixture id or the `session-1` fixture
 * id appearing as a literal or path segment.
 */
const SRC_ROOT = join(process.cwd(), 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx)$/.test(name) && !/\.test\.|\.spec\./.test(name) ? [path] : [];
  });
}

const sources = Object.freeze(
  sourceFiles(SRC_ROOT).map((file) => Object.freeze({ file, source: readFileSync(file, 'utf8') })),
);

const FIXTURE_ID_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'enc-* encounter fixture id', pattern: /\benc-[A-Za-z0-9][A-Za-z0-9_-]*/ },
  { name: 'session-1 fixture id', pattern: /['"`/]session-1\b/ },
];

describe('test-fixture ids in production source (#2525)', () => {
  it.each(FIXTURE_ID_PATTERNS)(
    'has no $name literal outside __tests__ and test files',
    ({ pattern }) => {
      const offenders = sources
        .filter(({ source }) => pattern.test(source))
        .map(({ file }) => relative(process.cwd(), file));

      expect(offenders).toEqual([]);
    },
  );
});

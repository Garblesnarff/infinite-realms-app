import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
// Split so this file does not contain the forbidden source text.
const FORBIDDEN = 'import.meta' + '?.env';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name.startsWith('._') || name === 'node_modules' || name === 'dist') return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('import.meta.env form', () => {
  it('has no optional chaining on import.meta.env under src', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => readFileSync(file, 'utf8').includes(FORBIDDEN))
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

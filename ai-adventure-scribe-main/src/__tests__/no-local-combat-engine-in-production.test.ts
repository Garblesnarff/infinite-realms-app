import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #621 Part A guard. Damage and heals go to the server only. The client local combat engine (local
 * HP and death-save maths) was deleted in #621 Part B2b step 2. Nothing in production code may
 * reference it.
 *
 * The allowlist is empty: no production file may reference `dealDamage`, `healDamage` or
 * `rollDeathSave`. Any entry added here would need a reviewed reason.
 */
const SRC_ROOT = join(process.cwd(), 'src');

const LOCAL_ENGINE_ALLOWLIST: string[] = [];

const LOCAL_ENGINE_REFERENCE = /\b(dealDamage|healDamage|rollDeathSave)\b/;

function listProductionSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'test' || name === 'tests') continue;
      out.push(...listProductionSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.|\.spec\./.test(name)) continue;
    out.push(full);
  }
  return out;
}

describe('local combat engine stays out of production calls (#621 Part A)', () => {
  const files = listProductionSourceFiles(SRC_ROOT).map((f) =>
    relative(SRC_ROOT, f).split('\\').join('/'),
  );

  it('no production file outside the allowlist references the local engine', () => {
    const offenders = files.filter((rel) => {
      if (LOCAL_ENGINE_ALLOWLIST.includes(rel)) return false;
      return LOCAL_ENGINE_REFERENCE.test(readFileSync(join(SRC_ROOT, rel), 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry still exists and still references the engine (no stale entries)', () => {
    const stale = LOCAL_ENGINE_ALLOWLIST.filter((rel) => {
      if (!files.includes(rel)) return true;
      return !LOCAL_ENGINE_REFERENCE.test(readFileSync(join(SRC_ROOT, rel), 'utf8'));
    });
    expect(stale).toEqual([]);
  });

  it('the server-authoritative damage hook does not reference the local engine', () => {
    const hook = readFileSync(
      join(SRC_ROOT, 'contexts/game/use-damage-auto-application.ts'),
      'utf8',
    );
    expect(LOCAL_ENGINE_REFERENCE.test(hook)).toBe(false);
    expect(hook).toContain('applyCharacterDamage');
  });
});

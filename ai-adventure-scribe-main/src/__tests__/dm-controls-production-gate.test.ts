import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #621 B2b step 4. The game-master combat controls (End Combat, Next Turn, Add Enemy, Begin Combat,
 * damage and healing, enemy attacks) never mount in a production build. The only mount of
 * `CombatInterface` is `GameCombatSheet`, and it passes `isDM` only when `import.meta.env.DEV` is
 * true. In a production build that constant is false, so `isDM` is false and every control behind
 * it stays unmounted.
 *
 * This guard fails if the gate changes, or if another production file mounts `CombatInterface`.
 * Either change would expose the DM tool to players in a production build.
 */
const SRC_ROOT = join(process.cwd(), 'src');
const SHEET = 'features/game-session/components/game/game-content/GameCombatSheet.tsx';
const GATE = 'isDM={isDM && import.meta.env.DEV}';

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

describe('the game-master combat controls render only in dev builds (#621 B2b step 4)', () => {
  const files = listProductionSourceFiles(SRC_ROOT).map((f) =>
    relative(SRC_ROOT, f).split('\\').join('/'),
  );

  it('GameCombatSheet gates isDM on import.meta.env.DEV', () => {
    const source = readFileSync(join(SRC_ROOT, SHEET), 'utf8');
    expect(source.split(GATE).length - 1).toBe(1);
  });

  it('GameCombatSheet is the only production file that mounts CombatInterface', () => {
    const mounts = files.filter((rel) =>
      /<CombatInterface[\s>]/.test(readFileSync(join(SRC_ROOT, rel), 'utf8')),
    );
    expect(mounts).toEqual([SHEET]);
  });
});

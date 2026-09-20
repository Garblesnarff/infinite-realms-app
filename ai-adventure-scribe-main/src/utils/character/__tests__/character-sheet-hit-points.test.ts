import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateHitPoints } from '../basic-math';
import {
  formatCharacterSheetHitPoints,
  getCharacterSheetHitPoints,
} from '../character-sheet-hit-points';
import { transformCharacterData } from '../data-transformers';

import type { Character } from '@/types/character';

import { buildStarterCharacterSeed } from '@/services/character/starter-character-seeding';

const testDirectory = dirname(fileURLToPath(import.meta.url));
/*
 * MulticlassManager is intentionally omitted: it is a mutation-preview surface, so its
 * multiclass-aware formula must reflect add-class/level-up changes before stored HP catches up.
 * Add every new existing-character display consumer here; the eventual stronger guard is an
 * ESLint no-restricted-imports rule scoped to display directories.
 */
const EXISTING_CHARACTER_DISPLAY_CONSUMERS = [
  '../../../features/game-session/components/game/CompactCharacterHeader.tsx',
  '../../../features/game-session/components/game/StatsBar.tsx',
  '../../../features/game-session/components/game/FloatingActionPanel.tsx',
  '../../../features/game-session/components/game/overhaul/useOverhaulViewModel.ts',
  '../../../features/character/components/sheet/CharacterSheetHeader.tsx',
  '../../../features/character/components/sheet/tabs/MainTab.tsx',
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCharacterSheetHitPoints', () => {
  it('does not import or call the preview HP calculator', () => {
    const source = readFileSync(resolve(testDirectory, '../character-sheet-hit-points.ts'), 'utf8');

    expect(source).not.toContain('calculateHitPoints');
  });

  it('keeps existing-character display consumers on the stored HP helper', () => {
    for (const relativePath of EXISTING_CHARACTER_DISPLAY_CONSUMERS) {
      const source = readFileSync(resolve(testDirectory, relativePath), 'utf8');

      expect(source, relativePath).toContain('getCharacterSheetHitPoints');
      expect(source, relativePath).not.toContain('calculateHitPoints');
    }
  });

  it('displays stored 7 HP when it disagrees with preview math', () => {
    const character = transformCharacterData(
      {
        id: 'char-123',
        user_id: 'user-456',
        name: 'The Apprentice',
        race: 'Human',
        class: 'Wizard',
        level: 1,
      },
      {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        current_hit_points: 7,
        max_hit_points: 7,
      },
      [],
    );

    expect(calculateHitPoints(character)).toBe(6);
    const hitPoints = getCharacterSheetHitPoints(character);
    expect(hitPoints).toEqual({ current: 7, maximum: 7 });
    expect(formatCharacterSheetHitPoints(hitPoints)).toBe('7/7');
  });

  it('renders an em dash and warns once when stored max HP is null', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const character = {
      id: 'missing-max-hp',
      character_stats: { current_hit_points: 7, max_hit_points: null },
    } as unknown as Character;

    const first = getCharacterSheetHitPoints(character);
    const second = getCharacterSheetHitPoints(character);

    expect(first).toEqual({ current: 7, maximum: null });
    expect(formatCharacterSheetHitPoints(first)).toBe('—');
    expect(formatCharacterSheetHitPoints(second)).toBe('—');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('shows stored max HP for a freshly created premade', () => {
    const seed = buildStarterCharacterSeed(
      {
        name: 'The Veteran',
        race: 'Human',
        class: 'Fighter',
        level: 1,
        ability_scores: {
          strength: 16,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 13,
          charisma: 10,
        },
      },
      'abyssal-descent',
    );
    const stats = seed.stats as {
      current_hit_points: number;
      max_hit_points: number;
    };
    const character = { id: 'fresh-premade', character_stats: stats } as Character;

    expect(stats).toMatchObject({ current_hit_points: 12, max_hit_points: 12 });
    const hitPoints = getCharacterSheetHitPoints(character);
    expect(hitPoints).toEqual({ current: 12, maximum: 12 });
    expect(formatCharacterSheetHitPoints(hitPoints)).toBe('12/12');
  });

  it('preserves a stored zero current HP', () => {
    const character: Character = {
      class: { name: 'Wizard', hitDie: 6 } as Character['class'],
      character_stats: {
        current_hit_points: 0,
        max_hit_points: 10,
      },
    };

    expect(getCharacterSheetHitPoints(character)).toEqual({ current: 0, maximum: 10 });
  });

  it('accepts both normalized sheet stats and roster join arrays', () => {
    const sheetCharacter: Character = {
      character_stats: { current_hit_points: 4, max_hit_points: 10 },
    };
    const rosterCharacter: Character = {
      character_stats: [{ current_hit_points: 4, max_hit_points: 10 }],
    };

    expect(getCharacterSheetHitPoints(sheetCharacter)).toEqual({ current: 4, maximum: 10 });
    expect(getCharacterSheetHitPoints(rosterCharacter)).toEqual({ current: 4, maximum: 10 });
  });
});

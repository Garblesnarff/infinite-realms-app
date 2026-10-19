/**
 * #130 coverage (not a regression test): engine applies 3 damage to the player
 * → sheet shows 9/12.
 *
 * This is the combat damage path (the issue's evidence: tracker 9/12, sheet
 * 12/12 during an NPC turn). The combat path is already covered by
 * `character-hp-follows-encounter.test.tsx` (#2641) and passes on main: the
 * `combat-state-updated` event triggers a refetch via
 * `useCharacterRefreshOnCombatUpdate`.
 *
 * This test documents that the same refetch mechanism handles the specific
 * 12→9 HP divergence from the issue, using the real hook and event path.
 * It is coverage, not a regression test (it passes on main).
 *
 * Real: CharacterProvider, the character reducer, the refresh hook, StatsBar.
 * Stubbed: `characterLoaderService.loadCharacterWithSpells` answering with the
 * post-damage HP (9/12) as the server's stats row holds it.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatsBar } from '../StatsBar';
import { useCharacterRefreshOnCombatUpdate } from '../use-character-refresh';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { buildAbilityScores } from '@/services/build-ability-scores';
import { characterLoaderService } from '@/services/character-loader';
import { hydrateCharacterStats } from '@/services/hydrate-character-stats';
import { normalizeCharacter } from '@/services/user-data-payload-helpers';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/character-loader', () => ({
  characterLoaderService: { loadCharacterWithSpells: vi.fn() },
}));
vi.mock('@/services/auth/TokenService', async (importOriginal) =>
  (await import('@/test/token-service-mock')).createTokenServiceMock(importOriginal, {
    getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
    getAccessToken: vi.fn(() => 'test'),
  }),
);

const CHARACTER_ID = '4b6ec35d-45eb-427b-b8db-7299a6dd4d77';

/** Premade Fighter from /explore (Abyssal Descent), as in issue #130. */
const rawCharacter = (currentHp: number) => ({
  id: CHARACTER_ID,
  name: 'The Veteran',
  class: 'Fighter',
  level: 1,
  stats: {
    strength: 16,
    dexterity: 12,
    constitution: 14,
    intelligence: 10,
    wisdom: 13,
    charisma: 10,
    max_hit_points: 12,
    current_hit_points: currentHp,
    armor_class: 18,
  },
});

const loadedCharacter = (currentHp: number) => {
  const raw = normalizeCharacter(rawCharacter(currentHp));
  const stats = (
    raw as unknown as {
      character_stats: Array<{
        strength: number;
        dexterity: number;
        constitution: number;
        intelligence: number;
        wisdom: number;
        charisma: number;
        max_hit_points: number;
        current_hit_points: number;
        armor_class: number;
      }>;
    }
  ).character_stats[0];
  return {
    id: raw.id,
    name: raw.name,
    level: raw.level,
    abilityScores: buildAbilityScores({
      strength: stats.strength,
      dexterity: stats.dexterity,
      constitution: stats.constitution,
      intelligence: stats.intelligence,
      wisdom: stats.wisdom,
      charisma: stats.charisma,
    }),
    character_stats: hydrateCharacterStats({ ...stats, current_hit_points: currentHp }),
  };
};

function TestHarness() {
  const { dispatch } = useCharacter();
  useCharacterRefreshOnCombatUpdate(CHARACTER_ID, 'user-1', dispatch);
  return <StatsBar />;
}

describe('#130 coverage: engine applies 3 damage, sheet shows 9/12', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sheet reflects 9/12 after the engine applies 3 damage (coverage, passes on main)', async () => {
    // The server's stats row after the engine applies 3 damage: 9/12.
    const afterDamage = loadedCharacter(9);
    vi.mocked(characterLoaderService.loadCharacterWithSpells).mockResolvedValue(afterDamage);

    render(
      <CharacterProvider>
        <TestHarness />
      </CharacterProvider>,
    );

    // The engine applies damage during the NPC turn; the combat state update
    // event fires (via socket or refreshCombatState pull).
    await act(async () => {
      window.dispatchEvent(new CustomEvent('combat-state-updated'));
    });

    await waitFor(() => {
      expect(characterLoaderService.loadCharacterWithSpells).toHaveBeenCalledWith(
        CHARACTER_ID,
        'user-1',
      );
    });

    // The sheet now shows 9/12, not the stale 12/12 from the issue.
    await waitFor(() => {
      expect(screen.getByText(/9\/12/)).toBeInTheDocument();
    });
  });
});

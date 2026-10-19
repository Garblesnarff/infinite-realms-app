/**
 * #130: the live character sheet does not refresh after story damage is applied
 * or items are granted/removed. Story damage (applyStoryDamageOnce) and story
 * items (applyStoryItemsOnce) are applied server-side during the DM turn with
 * no combat event, so `useCharacterRefreshOnCombatUpdate` never refetches and
 * the sheet stays stale.
 *
 * The fix: a `character-state-updated` window event that triggers the same
 * refetch path. The server publishes `character_state_updated` on the session
 * socket after a story applier (damage, items, XP) writes;
 * `use-session-story-socket` dispatches this window event; the hook refetches
 * via `characterLoaderService`.
 *
 * Real: CharacterProvider, the character reducer, the refresh hook, StatsBar.
 * Stubbed: `characterLoaderService.loadCharacterWithSpells` (the API edge)
 * answering with what the server's stats row holds after story damage.
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

/** The raw `GET /v1/characters/:id` shape after story damage: 9/12 HP. */
const rawCharacterAfterStoryDamage = () => ({
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
    current_hit_points: 9,
    armor_class: 18,
  },
});

/**
 * The character the game screen holds after refetch: `loadCharacterWithSpells`
 * runs the API's raw character through `normalizeCharacter` and copies the
 * stats row with `hydrateCharacterStats`.
 */
const loadedCharacter = (currentHp: number) => {
  const raw = normalizeCharacter(rawCharacterAfterStoryDamage());
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

describe('#130 character-state-updated triggers refetch after story damage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refetches the character when character-state-updated is dispatched', async () => {
    const refreshed = loadedCharacter(9);
    vi.mocked(characterLoaderService.loadCharacterWithSpells).mockResolvedValue(refreshed);

    render(
      <CharacterProvider>
        <TestHarness />
      </CharacterProvider>,
    );

    // Simulate the server notifying that story damage was applied.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('character-state-updated'));
    });

    await waitFor(() => {
      expect(characterLoaderService.loadCharacterWithSpells).toHaveBeenCalledWith(
        CHARACTER_ID,
        'user-1',
      );
    });

    // The header now shows the post-damage HP, not the stale value.
    await waitFor(() => {
      expect(screen.getByText(/9\/12/)).toBeInTheDocument();
    });
  });

  it('does not refetch when characterId is null', async () => {
    function NullHarness() {
      const { dispatch } = useCharacter();
      useCharacterRefreshOnCombatUpdate(null, 'user-1', dispatch);
      return <StatsBar />;
    }

    render(
      <CharacterProvider>
        <NullHarness />
      </CharacterProvider>,
    );

    await act(async () => {
      window.dispatchEvent(new CustomEvent('character-state-updated'));
    });

    // Give the event loop a chance to (not) fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(characterLoaderService.loadCharacterWithSpells).not.toHaveBeenCalled();
  });
});

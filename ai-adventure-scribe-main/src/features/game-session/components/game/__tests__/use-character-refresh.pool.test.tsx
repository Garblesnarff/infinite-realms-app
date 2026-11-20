import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCharacterRefreshOnCombatUpdate } from '../use-character-refresh';

const loader = vi.hoisted(() => ({ loadCharacterWithSpells: vi.fn(async () => null) }));
vi.mock('@/services/character-loader', () => ({ characterLoaderService: loader }));

/**
 * #1670: an intent result's pool number goes to the character context at once, as a non-dirty
 * tracked-uses action, with no refetch needed for the panel to show it.
 */
describe('useCharacterRefreshOnCombatUpdate pool numbers (#1670)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a character-pool-updated event dispatches SET_TRACKED_USES with the engine numbers', () => {
    const dispatch = vi.fn();
    renderHook(() => useCharacterRefreshOnCombatUpdate('char-1', 'user-1', dispatch));
    window.dispatchEvent(
      new CustomEvent('character-pool-updated', {
        detail: { feature: 'lay_on_hands', currentUses: 5, maxUses: 15 },
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_TRACKED_USES',
      payload: { feature: 'lay_on_hands', currentUses: 5, maxUses: 15 },
    });
    expect(loader.loadCharacterWithSpells).not.toHaveBeenCalled();
  });

  it('ignores a pool event with no numeric remaining uses', () => {
    const dispatch = vi.fn();
    renderHook(() => useCharacterRefreshOnCombatUpdate('char-1', 'user-1', dispatch));
    window.dispatchEvent(
      new CustomEvent('character-pool-updated', { detail: { feature: 'second_wind' } }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});

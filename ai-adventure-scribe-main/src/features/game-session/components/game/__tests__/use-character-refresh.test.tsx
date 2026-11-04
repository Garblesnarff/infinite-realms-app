/**
 * #1357: the session socket reopened after a drop, and events sent while it was closed are lost.
 * `useCharacterRefreshOnCombatUpdate` listens for `session-socket-reconnected` and refetches the
 * character once. Once unmounted, the listener must be gone.
 *
 * Stubbed: `characterLoaderService.loadCharacterWithSpells` (the API edge).
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCharacterRefreshOnCombatUpdate } from '../use-character-refresh';

import { characterLoaderService } from '@/services/character-loader';

vi.mock('@/services/character-loader', () => ({
  characterLoaderService: { loadCharacterWithSpells: vi.fn() },
}));

const CHARACTER_ID = '4b6ec35d-45eb-427b-b8db-7299a6dd4d77';

describe('#1357 session-socket-reconnected refetches the character once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(characterLoaderService.loadCharacterWithSpells).mockResolvedValue(null as never);
  });

  it('calls the loader once per reconnect event and stops after unmount', async () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useCharacterRefreshOnCombatUpdate(CHARACTER_ID, 'user-1', dispatch),
    );
    expect(characterLoaderService.loadCharacterWithSpells).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new CustomEvent('session-socket-reconnected'));
    });
    expect(characterLoaderService.loadCharacterWithSpells).toHaveBeenCalledTimes(1);
    expect(characterLoaderService.loadCharacterWithSpells).toHaveBeenCalledWith(
      CHARACTER_ID,
      'user-1',
    );

    unmount();
    await act(async () => {
      window.dispatchEvent(new CustomEvent('session-socket-reconnected'));
    });
    expect(characterLoaderService.loadCharacterWithSpells).toHaveBeenCalledTimes(1);
  });
});

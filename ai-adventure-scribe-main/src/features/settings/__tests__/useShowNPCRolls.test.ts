import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tableSettingsKey, writeTableSettings } from '../table-settings';
import { useShowNPCRolls } from '../useShowNPCRolls';

const mockUser = { id: 'user-a' as string | null };
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ user: mockUser.id ? { id: mockUser.id } : null }),
}));

describe('useShowNPCRolls (#1347)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUser.id = 'user-a';
  });

  it('is on by default for a signed-in user with no saved choice', () => {
    const { result } = renderHook(() => useShowNPCRolls());
    expect(result.current).toBe(true);
  });

  it('is on when no user is signed in', () => {
    mockUser.id = null;
    const { result } = renderHook(() => useShowNPCRolls());
    expect(result.current).toBe(true);
  });

  it('reads the saved choice', () => {
    window.localStorage.setItem(
      tableSettingsKey('user-a'),
      JSON.stringify({ showNPCRolls: false }),
    );
    const { result } = renderHook(() => useShowNPCRolls());
    expect(result.current).toBe(false);
  });

  it('follows a settings write without a reload', () => {
    const { result } = renderHook(() => useShowNPCRolls());
    expect(result.current).toBe(true);
    act(() => {
      writeTableSettings('user-a', {
        showTargetNumbers: true,
        narrationAutoPlay: false,
        narrationVolume: 1,
        narrationSpeed: 1,
        diceSound: true,
        tableLook: true,
        reduceMotion: 'system',
        showNPCRolls: false,
      });
    });
    expect(result.current).toBe(false);
  });
});

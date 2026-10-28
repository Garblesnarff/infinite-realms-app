/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1239 item 1: the session-start "Rest first?" gate. A fresh continuation
 * session (session_number above 1, turn_count 0) starting below max HP
 * prompts; every other shape fails open to the game. The rest is the
 * existing long-rest route; the hero is reloaded through the same loader
 * the game load uses.
 */
import { act, renderHook, waitFor, type RenderHookResult } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionRestGate, type SessionRestGate } from '../use-session-rest-gate';

import type { Character } from '@/types/character';

vi.mock('@/services/rest-api', () => ({
  restApi: { longRest: vi.fn() },
}));
vi.mock('@/services/character-loader', () => ({
  characterLoaderService: { loadCharacterWithSpells: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { characterLoaderService } from '@/services/character-loader';
import { restApi } from '@/services/rest-api';

const characterAt = (current: number | null, maximum: number | null): Character =>
  ({
    id: 'char-1',
    name: 'Sera Voss',
    character_stats:
      current === null && maximum === null
        ? undefined
        : { current_hit_points: current ?? undefined, max_hit_points: maximum ?? undefined },
  }) as unknown as Character;

describe('useSessionRestGate (#1239)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  const renderGate = (
    overrides: Record<string, unknown> = {},
  ): RenderHookResult<SessionRestGate, unknown> =>
    renderHook(() =>
      useSessionRestGate({
        sessionId: 'session-1',
        session: { session_number: 2, turn_count: 0 },
        character: characterAt(2, 10),
        dispatch: vi.fn(),
        ...overrides,
      }),
    );

  it('prompts on a fresh continuation below max HP', () => {
    const { result } = renderGate();
    expect(result.current.showPrompt).toBe(true);
    expect(result.current.currentHp).toBe(2);
    expect(result.current.maxHp).toBe(10);
  });

  it('stays hidden on the first session of an adventure', () => {
    const { result } = renderGate({ session: { session_number: 1, turn_count: 0 } });
    expect(result.current.showPrompt).toBe(false);
  });

  it('stays hidden once a turn has been played', () => {
    const { result } = renderGate({ session: { session_number: 2, turn_count: 3 } });
    expect(result.current.showPrompt).toBe(false);
  });

  it('stays hidden at full HP', () => {
    const { result } = renderGate({ character: characterAt(10, 10) });
    expect(result.current.showPrompt).toBe(false);
  });

  it('fails open when HP is unknown', () => {
    const { result } = renderGate({ character: characterAt(null, null) });
    expect(result.current.showPrompt).toBe(false);
  });

  it('stays hidden at 0 HP — the server refuses a rest while dying', () => {
    const { result } = renderGate({ character: characterAt(0, 10) });
    expect(result.current.showPrompt).toBe(false);
  });

  it('stays hidden without a session or a character', () => {
    expect(renderGate({ sessionId: null }).result.current.showPrompt).toBe(false);
    expect(renderGate({ character: null }).result.current.showPrompt).toBe(false);
  });

  it('rest first rests, reloads, dispatches, and resolves', async () => {
    const dispatch = vi.fn();
    const refreshed = characterAt(10, 10);
    vi.mocked(restApi.longRest).mockResolvedValue({} as any);
    vi.mocked(characterLoaderService.loadCharacterWithSpells).mockResolvedValue(
      refreshed as any,
    );

    const { result } = renderGate({ dispatch });
    await act(async () => {
      result.current.restFirst();
    });

    await waitFor(() => {
      expect(result.current.showPrompt).toBe(false);
    });
    expect(restApi.longRest).toHaveBeenCalledWith('char-1');
    expect(characterLoaderService.loadCharacterWithSpells).toHaveBeenCalledWith('char-1');
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CHARACTER', payload: refreshed });
    expect(window.sessionStorage.getItem('ir:rest-first-resolved:session-1')).toBe('1');
  });

  it('a rest whose reload returns nothing keeps the prompt with an error', async () => {
    const dispatch = vi.fn();
    vi.mocked(restApi.longRest).mockResolvedValue({} as any);
    vi.mocked(characterLoaderService.loadCharacterWithSpells).mockResolvedValue(
      null as any,
    );

    const { result } = renderGate({ dispatch });
    await act(async () => {
      result.current.restFirst();
    });

    await waitFor(() => {
      expect(result.current.restError).toMatch(/could not be reloaded/);
    });
    expect(result.current.showPrompt).toBe(true);
    expect(result.current.resting).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('ir:rest-first-resolved:session-1')).toBeNull();
  });

  it('a failed rest keeps the prompt and surfaces the error', async () => {
    vi.mocked(restApi.longRest).mockRejectedValue(new Error('rest refused'));

    const { result } = renderGate();
    await act(async () => {
      result.current.restFirst();
    });

    await waitFor(() => {
      expect(result.current.restError).toBe('rest refused');
    });
    expect(result.current.showPrompt).toBe(true);
    expect(result.current.resting).toBe(false);
    expect(characterLoaderService.loadCharacterWithSpells).not.toHaveBeenCalled();
  });

  it('continue as you are resolves without resting', () => {
    const { result } = renderGate();
    act(() => {
      result.current.continueAsIs();
    });
    expect(result.current.showPrompt).toBe(false);
    expect(restApi.longRest).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('ir:rest-first-resolved:session-1')).toBe('1');
  });

  it('a resolved session does not prompt again on remount', () => {
    window.sessionStorage.setItem('ir:rest-first-resolved:session-1', '1');
    const { result } = renderGate();
    expect(result.current.showPrompt).toBe(false);
  });

  it('a new session prompts again after the session changes', () => {
    window.sessionStorage.setItem('ir:rest-first-resolved:session-1', '1');
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useSessionRestGate({
          sessionId,
          session: { session_number: 2, turn_count: 0 },
          character: characterAt(2, 10),
          dispatch: vi.fn(),
        }),
      { initialProps: { sessionId: 'session-1' } },
    );
    expect(result.current.showPrompt).toBe(false);
    rerender({ sessionId: 'session-2' });
    expect(result.current.showPrompt).toBe(true);
  });
});

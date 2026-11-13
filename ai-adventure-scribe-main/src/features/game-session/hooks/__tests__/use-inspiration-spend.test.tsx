import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

import { useInspirationSpend } from '../use-inspiration-spend';

import { useCharacter } from '@/contexts/CharacterContext';
import { useInspirationArmed } from '@/features/game-session/contexts/inspiration-armed-context';
import { UserDataApiRequestError, userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/features/game-session/contexts/inspiration-armed-context', () => ({
  useInspirationArmed: vi.fn(),
}));

const character = { id: 'character-1', name: 'Test Hero', inspiration: true };

describe('useInspirationSpend (#1472)', () => {
  let dispatch: ReturnType<typeof vi.fn>;
  let arm: ReturnType<typeof vi.fn>;
  let disarm: ReturnType<typeof vi.fn>;
  let spend: MockInstance;

  beforeEach(() => {
    dispatch = vi.fn();
    arm = vi.fn();
    disarm = vi.fn();
    vi.mocked(useCharacter).mockReturnValue({
      state: { character },
      dispatch,
    } as unknown as ReturnType<typeof useCharacter>);
    vi.mocked(useInspirationArmed).mockReturnValue({
      armed: true,
      arm,
      disarm,
    } as unknown as ReturnType<typeof useInspirationArmed>);
    spend = vi.spyOn(userDataApi, 'spendInspiration');
  });

  afterEach(() => {
    spend.mockRestore();
    vi.clearAllMocks();
  });

  it('a 409 from the server sets the coin to spent and clears the arm', async () => {
    spend.mockRejectedValue(
      new UserDataApiRequestError('No inspiration to spend (409)', 409, {
        error: 'no_inspiration',
      }),
    );
    const { result } = renderHook(() => useInspirationSpend());

    let spent = true;
    await act(async () => {
      spent = await result.current.spendInspiration('character-1');
    });

    expect(spent).toBe(false);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { ...character, inspiration: false },
    });
    expect(disarm).toHaveBeenCalled();
    // A 409 is final: the server already spent the flag, so there is no retry.
    expect(spend).toHaveBeenCalledTimes(1);
  });

  it('a non-409 failure is retried once; when the retry works the coin shows spent', async () => {
    spend
      .mockRejectedValueOnce(
        new UserDataApiRequestError('Request failed (500)', 500, { error: 'boom' }),
      )
      .mockResolvedValueOnce({ inspiration: false });
    const { result } = renderHook(() => useInspirationSpend());

    let spent = false;
    await act(async () => {
      spent = await result.current.spendInspiration('character-1');
    });

    expect(spent).toBe(true);
    expect(spend).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { ...character, inspiration: false },
    });
    // The spend went through, so the caller clears the arm.
    expect(disarm).not.toHaveBeenCalled();
  });

  it('a non-409 failure twice leaves the flag true: no coin change, the arm is kept (#1472)', async () => {
    spend.mockRejectedValue(
      new UserDataApiRequestError('Request failed (500)', 500, { error: 'boom' }),
    );
    const { result } = renderHook(() => useInspirationSpend());

    let spent = true;
    await act(async () => {
      spent = await result.current.spendInspiration('character-1');
    });

    expect(spent).toBe(false);
    expect(spend).toHaveBeenCalledTimes(2);
    // The server flag is still true, so the coin must not turn grey and the arm must stay.
    expect(dispatch).not.toHaveBeenCalled();
    expect(disarm).not.toHaveBeenCalled();
  });
});

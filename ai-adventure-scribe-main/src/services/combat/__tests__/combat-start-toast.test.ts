/* eslint-disable @typescript-eslint/no-explicit-any */
import { toast as sonnerToast } from 'sonner';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CombatStartError } from '../combat-start-failure';
import { notifyRetryableCombatStartFailure } from '../combat-start-toast';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('notifyRetryableCombatStartFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const runTestForStage = (stage: any, expectedMessage: string): void => {
    const error = new CombatStartError(
      500,
      stage,
      'Detailed error info',
      '{"error":"Detailed error info"}',
      { dummy: 'envelope' }
    );
    const mockRetry = vi.fn().mockResolvedValue(undefined);

    notifyRetryableCombatStartFailure(error, mockRetry);

    expect(sonnerToast.error).toHaveBeenCalledTimes(1);
    expect(sonnerToast.error).toHaveBeenCalledWith(
      "Combat couldn't start",
      expect.objectContaining({
        description: expect.stringContaining(expectedMessage),
        duration: Infinity,
        action: expect.objectContaining({
          label: 'Retry',
          onClick: expect.any(Function),
        }),
      })
    );

    // Call the retry click callback to ensure it invokes our retry handler
    const toastCallArgs = vi.mocked(sonnerToast.error).mock.calls[0][1] as any;
    toastCallArgs.action.onClick();
    expect(mockRetry).toHaveBeenCalledTimes(1);
  };

  it('handles "ownership" stage failure', () => {
    runTestForStage('ownership', 'This session could not be verified. Try reloading the page. (500, ownership)');
  });

  it('handles "participants" stage failure', () => {
    runTestForStage('participants', 'The combatants could not be set up. (500, participants)');
  });

  it('handles "map_generation" stage failure', () => {
    runTestForStage('map_generation', 'The battle map could not be generated. (500, map_generation)');
  });

  it('handles "persistence" stage failure', () => {
    runTestForStage('persistence', 'Combat started but could not be saved. (500, persistence)');
  });

  it('handles "unknown" stage failure', () => {
    runTestForStage('unknown', 'The server could not start combat. (500)');
  });

  it('handles any other invalid/unmapped stage fallback failure', () => {
    runTestForStage('invalid_stage_name' as any, 'The server could not start combat. (500, invalid_stage_name)');
  });
});

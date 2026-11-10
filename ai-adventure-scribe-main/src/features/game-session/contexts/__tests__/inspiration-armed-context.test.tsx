import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  InspirationArmedProvider,
  useInspirationArmed,
} from '@/features/game-session/contexts/inspiration-armed-context';

vi.mock('@/contexts/CharacterContext', () => ({
  useOptionalCharacter: () => ({ state: { character: null }, dispatch: vi.fn() }),
}));

describe('useInspirationArmed', () => {
  it('returns a safe default outside the provider instead of throwing (round 4, CI fix)', () => {
    // useCombatLegalActions reads the armed state through useInspirationSpend and is
    // rendered outside GameProviders (DynamicOptionsSection in tests). Throwing here
    // broke every such render — use-ai-response.combat-options.test.tsx failed 17/17
    // in CI. Outside the provider there is no arm to share, so the hook reports not
    // armed and arm/disarm are no-ops.
    const { result } = renderHook(() => useInspirationArmed());
    expect(result.current.armed).toBe(false);
    expect(() => {
      act(() => {
        result.current.arm();
        result.current.disarm();
      });
    }).not.toThrow();
    expect(result.current.armed).toBe(false);
  });

  it('arms and disarms inside the provider', () => {
    const { result } = renderHook(() => useInspirationArmed(), {
      wrapper: ({ children }) => (
        <InspirationArmedProvider>{children}</InspirationArmedProvider>
      ),
    });
    expect(result.current.armed).toBe(false);
    act(() => {
      result.current.arm();
    });
    expect(result.current.armed).toBe(true);
    act(() => {
      result.current.disarm();
    });
    expect(result.current.armed).toBe(false);
  });
});

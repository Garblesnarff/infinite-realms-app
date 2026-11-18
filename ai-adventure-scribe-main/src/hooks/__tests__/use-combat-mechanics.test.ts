/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the hook
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/utils/classFeatures', () => ({
  getRageDamageBonus: vi.fn(),
  canUseClassFeature: vi.fn(),
}));

vi.mock('@/utils/combat/deathSaves', () => ({
  needsDeathSaves: vi.fn(),
  rollDeathSave: vi.fn(),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
  rollAttack: vi.fn(),
}));

import { useCombatMechanics } from '../use-combat-mechanics';

import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';
import * as classFeatures from '@/utils/classFeatures';
import * as deathSaves from '@/utils/combat/deathSaves';
import * as diceUtils from '@/utils/diceUtils';

describe('useCombatMechanics', () => {
  const mockHandleCombatAction = vi.fn();
  const mockTakeAction = vi.fn();
  const mockUpdateParticipant = vi.fn();

  const mockActiveEncounter: any = {
    id: 'enc-1',
    participants: [
      {
        id: 'p1',
        name: 'Hero',
        level: 5,
        racialTraits: [{ name: 'lucky' }],
        isRaging: false,
        characterClass: 'fighter',
        abilityScores: {
          constitution: { modifier: 2 },
        },
        activeConcentration: null,
      },
      {
        id: 'p2',
        name: 'Enemy',
        level: 5,
      },
    ],
  };

  const defaultProps: any = {
    activeEncounter: mockActiveEncounter,
    handleCombatAction: mockHandleCombatAction,
    takeAction: mockTakeAction,
    updateParticipant: mockUpdateParticipant,
    selectedEnemy: 'p2',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useCombatMechanics(defaultProps));

    expect(result.current.showAdvantageModal).toBe(false);
    expect(result.current.pendingAttack).toBe(null);
  });

  describe('handleEnhancedAttack', () => {
    it('sends a normal attack to the authoritative combat engine', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2', 'attack');
      });

      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('enc-1', {
        type: 'attack',
        actorId: 'p1',
        targetId: 'p2',
        advantage: false,
        disadvantage: false,
      });
    });

    it('leaves critical-hit and smite resolution to the server', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2', 'attack', false, false, 1);
      });

      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        expect.objectContaining({ type: 'attack', actorId: 'p1', targetId: 'p2' }),
      );
    });

    it('sends raging attacks without calculating Rage damage in the client', async () => {
      const barbarianProps = {
        ...defaultProps,
        activeEncounter: {
          id: 'enc-1',
          participants: [
            {
              id: 'p1',
              name: 'Barbarian',
              level: 5,
              isRaging: true,
              characterClass: 'barbarian',
            },
            { id: 'p2', name: 'Enemy' },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(barbarianProps));

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2');
      });

      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        expect.objectContaining({ type: 'attack', actorId: 'p1', targetId: 'p2' }),
      );
    });

    it('does not add a client-side Rage fallback when the server owns damage', async () => {
      const barbarianProps = {
        ...defaultProps,
        activeEncounter: {
          id: 'enc-1',
          participants: [
            {
              id: 'p1',
              name: 'Barbarian',
              level: 5,
              isRaging: true,
              characterClass: 'barbarian',
            },
            { id: 'p2', name: 'Enemy' },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(barbarianProps));

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2');
      });

      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        expect.objectContaining({ type: 'attack', actorId: 'p1', targetId: 'p2' }),
      );
    });

    it('should return early if participant not found', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      await act(async () => {
        await result.current.handleEnhancedAttack('non-existent');
      });
      expect(diceUtils.rollAttack).not.toHaveBeenCalled();
    });

    it('should return early if activeEncounter is null', async () => {
      const nullProps = { ...defaultProps, activeEncounter: null };
      const { result } = renderHook(() => useCombatMechanics(nullProps));
      await act(async () => {
        await result.current.handleEnhancedAttack('p1');
      });
      expect(diceUtils.rollAttack).not.toHaveBeenCalled();
    });
  });

  describe('handleClassFeature', () => {
    it('should handle Action Surge', async () => {
      const fighterProps = {
        ...defaultProps,
        activeEncounter: {
          id: 'enc-1',
          participants: [
            {
              id: 'p1',
              name: 'Fighter',
              classFeatures: [{ name: 'action_surge' }],
              resources: { action_surge: { current: 1 } },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(fighterProps));
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);

      await act(async () => {
        await result.current.handleClassFeature('p1', 'action_surge');
      });

      // #621 B2b: the server spends the use. Same body as the DM panel's Action Surge option.
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'action_surge', actorId: 'p1' },
        'dm',
        expect.any(Number),
        'typed',
      );
      expect(mockHandleCombatAction).not.toHaveBeenCalled();
    });

    it('should handle Second Wind', async () => {
      const fighterProps = {
        ...defaultProps,
        activeEncounter: {
          id: 'enc-1',
          participants: [
            {
              id: 'p1',
              name: 'Fighter',
              level: 5,
              classFeatures: [{ name: 'second_wind' }],
              resources: { second_wind: { current: 1 } },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(fighterProps));
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);

      await act(async () => {
        await result.current.handleClassFeature('p1', 'second_wind');
      });

      // #621 B2b: the server spends the use and rolls the heal. The browser rolls no dice.
      expect(diceUtils.rollDice).not.toHaveBeenCalled();
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'second_wind', actorId: 'p1' },
        'dm',
        expect.any(Number),
        'typed',
      );
      expect(mockHandleCombatAction).not.toHaveBeenCalled();
    });
  });

  describe('handleClassFeature with no server intent (#621 B2b step 2)', () => {
    it('sends nothing for a feature that has no server intent', async () => {
      vi.mocked(executeAuthoritativeCombatIntent).mockClear();
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);
      const { result } = renderHook(() =>
        useCombatMechanics({
          activeEncounter: {
            id: 'enc-1',
            participants: [
              {
                id: 'p1',
                name: 'Barbarian',
                classFeatures: [{ name: 'rage' }],
                resources: {},
                isRaging: false,
              },
            ],
            currentTurnParticipantId: 'p1',
          } as any,
        }),
      );

      await act(async () => {
        await result.current.handleClassFeature('p1', 'rage');
      });

      expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    });
  });

  describe('handleDeathSave', () => {
    it('should call the authoritative death_save intent (#261)', async () => {
      const dyingProps = {
        ...defaultProps,
        activeEncounter: {
          id: 'enc1',
          participants: [
            {
              id: 'p1',
              name: 'Dying Hero',
              currentHitPoints: 0,
              deathSaves: { successes: 0, failures: 0 },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(dyingProps));

      vi.mocked(deathSaves.needsDeathSaves).mockReturnValue(true);

      const { executeAuthoritativeCombatIntent } =
        await import('@/services/combat/combat-action-executor');

      await act(async () => {
        await result.current.handleDeathSave('p1');
      });

      // #261: the Roll button must hit the server's authoritative intent, not a
      // local roll. The engine owns the tallies.
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc1',
        { type: 'death_save', actorId: 'p1' },
        'player',
        undefined,
        'action_bar',
      );
      // The old local-only path is gone: no local state update.
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should return early if participant not found', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      await act(async () => {
        await result.current.handleDeathSave('non-existent');
      });
      expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    });
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useCombatDetection } from '../use-combat-detection';

import { getDamageRollForWeapon, createActionDescription } from '@/utils/combat/ai-narration-utils';
import { createCombatParticipantsFromDetection } from '@/utils/combat/participant-generation';
import { detectCombatFromText } from '@/utils/combatDetection';
import { rollDice } from '@/utils/diceUtils';

// Mock dependencies
vi.mock('@/utils/combatDetection', () => ({
  detectCombatFromText: vi.fn(),
}));

vi.mock('@/utils/combat/participant-generation', () => ({
  createCombatParticipantsFromDetection: vi.fn(),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
}));

vi.mock('@/utils/combat/ai-narration-utils', () => ({
  getDamageRollForWeapon: vi.fn(),
  createActionDescription: vi.fn(),
}));

describe('useCombatDetection', () => {
  const mockStartCombat = vi.fn().mockResolvedValue(undefined);
  const mockEndCombat = vi.fn().mockResolvedValue(undefined);
  const sessionId = 'test-session-id';

  const defaultState = {
    isInCombat: false,
    activeEncounter: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const setupHook = (initialState = defaultState) => {
    return renderHook(
      ({ state }) =>
        useCombatDetection({
          sessionId,
          state,
          startCombat: mockStartCombat,
          endCombat: mockEndCombat,
        }),
      {
        initialProps: { state: initialState },
      }
    );
  };

  it('should initialize correctly', () => {
    const { result } = setupHook();
    expect(result.current.processDMResponse).toBeDefined();
    expect(result.current.createCombatActionRoll).toBeDefined();
  });

  describe('processDMResponse', () => {
    it('should start combat when detection signals shouldStartCombat with high confidence', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: false,
        confidence: 0.9,
        enemies: [{ name: 'Orc', type: 'humanoid' }, { name: 'Goblin', type: 'humanoid' }],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);
      (createCombatParticipantsFromDetection as any).mockReturnValue([
        { name: 'Orc', initiative: 2 },
        { name: 'Goblin', initiative: 1 },
      ]);

      const { result } = setupHook();
      const response = await result.current.processDMResponse({
        text: 'Roll initiative!',
        sender: 'dm',
        timestamp: new Date().toISOString(),
      });

      expect(mockStartCombat).toHaveBeenCalledWith(sessionId, expect.any(Array));
      expect(response.shouldStartCombat).toBe(true);
      expect(response.combatMessages).toHaveLength(1);
      expect(response.combatMessages[0].text).toContain('Combat has begun');
      expect(response.combatMessages[0].text).toContain('2 combatants roll for initiative!');
    });

    it('should show singular combatant message if only one enemy', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: false,
        confidence: 0.9,
        enemies: [{ name: 'Orc', type: 'humanoid' }],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);
      (createCombatParticipantsFromDetection as any).mockReturnValue([{ name: 'Orc', initiative: 2 }]);

      const { result } = setupHook();
      const response = await result.current.processDMResponse({ text: 'Roll initiative!', sender: 'dm', timestamp: new Date().toISOString() });

      expect(response.combatMessages[0].text).toContain('Orc prepares for combat!');
    });

    it('should use default name if participant has no name', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: false,
        confidence: 0.9,
        enemies: [{ name: 'Orc', type: 'humanoid' }],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);
      (createCombatParticipantsFromDetection as any).mockReturnValue([{}]); // No name

      const { result } = setupHook();
      const response = await result.current.processDMResponse({ text: 'Roll initiative!', sender: 'dm', timestamp: new Date().toISOString() });

      expect(response.combatMessages[0].text).toContain('Fighter prepares for combat!');
    });

    it('should not start combat if confidence is below threshold', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: false,
        confidence: 0.3,
        enemies: [{ name: 'Orc', type: 'humanoid' }],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);

      const { result } = setupHook();
      await result.current.processDMResponse({ text: 'Maybe combat?', sender: 'dm', timestamp: new Date().toISOString() });

      expect(mockStartCombat).not.toHaveBeenCalled();
    });

    it('should not start combat if no enemies are detected', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: false,
        confidence: 0.9,
        enemies: [],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);

      const { result } = setupHook();
      await result.current.processDMResponse({ text: 'Roll initiative!', sender: 'dm', timestamp: new Date().toISOString() });

      expect(mockStartCombat).not.toHaveBeenCalled();
    });

    it('should end combat when detection signals shouldEndCombat', async () => {
      const mockDetection = {
        isCombat: false,
        shouldStartCombat: false,
        shouldEndCombat: true,
        confidence: 0.5,
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);

      const { result } = setupHook({
        isInCombat: true,
        activeEncounter: { id: 'enc-1' } as any,
      });

      const response = await result.current.processDMResponse({ text: 'The battle is over!', sender: 'dm', timestamp: new Date().toISOString() });

      expect(mockEndCombat).toHaveBeenCalled();
      expect(response.shouldEndCombat).toBe(true);
    });

    it('should prevent duplicate combat starts using ref guard', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: false,
        confidence: 0.9,
        enemies: [{ name: 'Orc', type: 'humanoid' }],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);
      (createCombatParticipantsFromDetection as any).mockReturnValue([{ name: 'Orc' }]);

      // Mock startCombat to be slow
      let resolveStart: any;
      const slowStart = new Promise<void>((resolve) => { resolveStart = resolve; });
      mockStartCombat.mockReturnValue(slowStart);

      const { result } = setupHook();

      // Trigger twice
      const p1 = result.current.processDMResponse({ text: 'Start!', sender: 'dm', timestamp: new Date().toISOString() });
      const p2 = result.current.processDMResponse({ text: 'Start!', sender: 'dm', timestamp: new Date().toISOString() });

      resolveStart();
      await Promise.all([p1, p2]);

      expect(mockStartCombat).toHaveBeenCalledTimes(1);
    });

    it('should handle mutual exclusivity: prefer end when already in combat', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: true,
        confidence: 0.9,
        enemies: [{ name: 'Orc' }],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);

      const { result } = setupHook({
        isInCombat: true,
        activeEncounter: { id: 'enc-1' } as any,
      });

      const response = await result.current.processDMResponse({ text: 'Win and Start?', sender: 'dm', timestamp: new Date().toISOString() });

      expect(response.shouldEndCombat).toBe(true);
      expect(response.shouldStartCombat).toBe(false);
    });

    it('should handle mutual exclusivity: prefer start when not in combat', async () => {
      const mockDetection = {
        isCombat: true,
        shouldStartCombat: true,
        shouldEndCombat: true,
        confidence: 0.9,
        enemies: [{ name: 'Orc' }],
      };
      (detectCombatFromText as any).mockReturnValue(mockDetection);

      const { result } = setupHook({
        isInCombat: false,
        activeEncounter: null,
      });

      const response = await result.current.processDMResponse({ text: 'Win and Start?', sender: 'dm', timestamp: new Date().toISOString() });

      expect(response.shouldEndCombat).toBe(false);
      expect(response.shouldStartCombat).toBe(true);
    });

    it('should respect 3s cooldown after combat ends', async () => {
      const { result, rerender } = setupHook({
        isInCombat: true,
        activeEncounter: { id: 'enc-1' } as any,
      });

      // End combat
      (detectCombatFromText as any).mockReturnValue({ shouldEndCombat: true, confidence: 1 });
      await result.current.processDMResponse({
        text: 'The battle is over!',
        sender: 'dm',
        timestamp: new Date().toISOString(),
      });
      expect(mockEndCombat).toHaveBeenCalled();

      // Simulate parent state update
      rerender({
        state: { isInCombat: false, activeEncounter: null },
      });

      // Immediately try to start again
      (detectCombatFromText as any).mockReturnValue({
        isCombat: true,
        shouldStartCombat: true,
        confidence: 1,
        enemies: [{ name: 'Orc' }],
      });
      await result.current.processDMResponse({
        text: 'New battle!',
        sender: 'dm',
        timestamp: new Date().toISOString(),
      });
      expect(mockStartCombat).not.toHaveBeenCalled();

      // Advance time by 4 seconds
      act(() => {
        vi.advanceTimersByTime(4000);
      });

      await result.current.processDMResponse({
        text: 'New battle!',
        sender: 'dm',
        timestamp: new Date().toISOString(),
      });
      expect(mockStartCombat).toHaveBeenCalled();
    });
  });

  describe('createCombatActionRoll', () => {
    it('should handle attack rolls', async () => {
      const action: any = { rollType: 'attack', actor: 'Orc', target: 'Player' };
      (rollDice as any).mockReturnValue({ total: 18, results: [13] });
      (createActionDescription as any).mockReturnValue('Orc hits Player');

      const { result } = setupHook();
      const rollData = await result.current.createCombatActionRoll(action);

      expect(rollDice).toHaveBeenCalledWith(20, 1, 5);
      expect(rollData?.type).toBe('attack_roll');
      expect(rollData?.success).toBe(true);
    });

    it('should handle damage rolls', async () => {
      const action: any = { rollType: 'damage', actor: 'Orc', weapon: 'sword' };
      (getDamageRollForWeapon as any).mockReturnValue({ dice: 8, count: 1, modifier: 3 });
      (rollDice as any).mockReturnValue({ total: 7, results: [4] });

      const { result } = setupHook();
      const rollData = await result.current.createCombatActionRoll(action);

      expect(getDamageRollForWeapon).toHaveBeenCalledWith('sword');
      expect(rollDice).toHaveBeenCalledWith(8, 1, 3);
      expect(rollData?.type).toBe('damage_roll');
    });

    it('should handle damage rolls without weapon', async () => {
      const action: any = { rollType: 'damage', actor: 'Orc' };
      (rollDice as any).mockReturnValue({ total: 7, results: [4] });

      const { result } = setupHook();
      const rollData = await result.current.createCombatActionRoll(action);

      expect(rollDice).toHaveBeenCalledWith(8, 1, 3);
      expect(rollData?.type).toBe('damage_roll');
    });

    it('should handle save rolls', async () => {
      const action: any = { rollType: 'save', actor: 'Player' };
      (rollDice as any).mockReturnValue({ total: 10, results: [8] });

      const { result } = setupHook();
      const rollData = await result.current.createCombatActionRoll(action);

      expect(rollDice).toHaveBeenCalledWith(20, 1, 2);
      expect(rollData?.type).toBe('saving_throw');
      expect(rollData?.success).toBe(false); // 10 < 13
    });

    it('should handle skill checks', async () => {
      const action: any = { rollType: 'skill', actor: 'Player' };
      (rollDice as any).mockReturnValue({ total: 15, results: [14] });

      const { result } = setupHook();
      const rollData = await result.current.createCombatActionRoll(action);

      expect(rollDice).toHaveBeenCalledWith(20, 1, 1);
      expect(rollData?.type).toBe('skill_check');
      expect(rollData?.success).toBe(true); // 15 >= 12
    });

    it('should return null for unknown roll types', async () => {
      const action: any = { rollType: 'unknown' };
      const { result } = setupHook();
      const rollData = await result.current.createCombatActionRoll(action);
      expect(rollData).toBeNull();
    });
  });
});

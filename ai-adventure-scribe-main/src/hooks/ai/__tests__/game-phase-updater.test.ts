import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { updateGamePhase, clampCombatIntentFlags } from '../game-phase-updater';
import type { CombatDetectionResult } from '@/utils/combatDetection';

describe('game-phase-updater', () => {
  describe('updateGamePhase', () => {
    const setGamePhase = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should transition from exploration to combat when combat is detected', () => {
      const combatDetection: CombatDetectionResult = {
        isCombat: true,
        confidence: 0.9,
        shouldStartCombat: true,
        shouldEndCombat: false,
        enemies: [],
        combatActions: []
      };

      updateGamePhase({
        combatDetection,
        currentPhase: 'exploration',
        isInCombat: false,
        setGamePhase
      });

      expect(setGamePhase).toHaveBeenCalledWith('combat');
    });

    it('should transition from combat to exploration when combat ends and context is inactive', () => {
      const combatDetection: CombatDetectionResult = {
        isCombat: false,
        confidence: 0.9,
        shouldStartCombat: false,
        shouldEndCombat: true,
        enemies: [],
        combatActions: []
      };

      updateGamePhase({
        combatDetection,
        currentPhase: 'combat',
        isInCombat: false,
        setGamePhase
      });

      expect(setGamePhase).toHaveBeenCalledWith('exploration');
    });

    it('should NOT transition to exploration if isInCombat is still true (active context)', () => {
      const combatDetection: CombatDetectionResult = {
        isCombat: false,
        confidence: 0.9,
        shouldStartCombat: false,
        shouldEndCombat: true,
        enemies: [],
        combatActions: []
      };

      updateGamePhase({
        combatDetection,
        currentPhase: 'combat',
        isInCombat: true,
        setGamePhase
      });

      expect(setGamePhase).not.toHaveBeenCalled();
    });

    it('should do nothing if combatDetection is undefined', () => {
      updateGamePhase({
        combatDetection: undefined,
        currentPhase: 'exploration',
        isInCombat: false,
        setGamePhase
      });

      expect(setGamePhase).not.toHaveBeenCalled();
    });

    it('should do nothing if already in combat phase', () => {
      const combatDetection: CombatDetectionResult = {
        isCombat: true,
        confidence: 0.9,
        shouldStartCombat: false,
        shouldEndCombat: false,
        enemies: [],
        combatActions: []
      };

      updateGamePhase({
        combatDetection,
        currentPhase: 'combat',
        isInCombat: true,
        setGamePhase
      });

      expect(setGamePhase).not.toHaveBeenCalled();
    });
  });

  describe('clampCombatIntentFlags', () => {
    it('should keep shouldStartCombat if both are true and NOT in combat', () => {
      const result = clampCombatIntentFlags(true, true, false);
      expect(result.shouldStartCombat).toBe(true);
      expect(result.shouldEndCombat).toBe(false);
    });

    it('should keep shouldEndCombat if both are true and already IN combat', () => {
      const result = clampCombatIntentFlags(true, true, true);
      expect(result.shouldStartCombat).toBe(false);
      expect(result.shouldEndCombat).toBe(true);
    });

    it('should return original flags if only one is true', () => {
      expect(clampCombatIntentFlags(true, false, false)).toEqual({
        shouldStartCombat: true,
        shouldEndCombat: false
      });
      expect(clampCombatIntentFlags(false, true, true)).toEqual({
        shouldStartCombat: false,
        shouldEndCombat: true
      });
    });

    it('should return both false if both are false', () => {
      const result = clampCombatIntentFlags(false, false, true);
      expect(result.shouldStartCombat).toBe(false);
      expect(result.shouldEndCombat).toBe(false);
    });
  });
});

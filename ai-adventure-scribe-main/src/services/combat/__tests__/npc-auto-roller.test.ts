/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  executeNPCRoll,
  executeAllNPCRolls,
  formatNPCRollResult,
  isAttackHit,
  isCheckSuccess,
} from '../npc-auto-roller';

import type { RollRequest } from '@/types/roll-request';

import { DiceEngine } from '@/services/dice/DiceEngine';

// Mock DiceEngine
vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    roll: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('npc-auto-roller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeNPCRoll', () => {
    it('should execute a roll successfully when autoExecute is true', async () => {
      const mockRequest: RollRequest = {
        type: 'attack',
        formula: '1d20+5',
        purpose: 'Longsword attack',
        autoExecute: true,
        actorName: 'Goblin',
        ac: 15,
      };

      const mockResult = {
        total: 18,
        naturalRoll: 13,
        critical: false,
        rolls: [{ dice: 20, value: 13 }],
      };

      (DiceEngine.roll as any).mockReturnValue(mockResult);

      const result = await executeNPCRoll(mockRequest);

      expect(DiceEngine.roll).toHaveBeenCalledWith('1d20+5', {
        advantage: undefined,
        disadvantage: undefined,
        purpose: 'Longsword attack',
        actorId: 'Goblin',
        secret: true,
      });
      expect(result.request).toBe(mockRequest);
      expect(result.result).toBe(mockResult);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should throw an error if autoExecute is not true', async () => {
      const mockRequest: RollRequest = {
        type: 'attack',
        formula: '1d20+5',
        purpose: 'Longsword attack',
        autoExecute: false,
      };

      await expect(executeNPCRoll(mockRequest)).rejects.toThrow(
        'executeNPCRoll called on non-auto-execute roll request',
      );
    });

    it('should handle DiceEngine errors', async () => {
      const mockRequest: RollRequest = {
        type: 'attack',
        formula: 'invalid',
        purpose: 'test',
        autoExecute: true,
      };

      (DiceEngine.roll as any).mockImplementation(() => {
        throw new Error('Roll failed');
      });

      await expect(executeNPCRoll(mockRequest)).rejects.toThrow('Roll failed');
    });
  });

  describe('executeAllNPCRolls', () => {
    it('should partition mixed roll requests correctly', async () => {
      const requests: RollRequest[] = [
        {
          type: 'attack',
          formula: '1d20+5',
          purpose: 'NPC 1',
          autoExecute: true,
          actorName: 'NPC 1',
        },
        { type: 'attack', formula: '1d20+3', purpose: 'Player 1', autoExecute: false },
        {
          type: 'damage',
          formula: '1d8+2',
          purpose: 'NPC 2',
          autoExecute: true,
          actorName: 'NPC 2',
        },
      ];

      const mockRoll1 = { total: 15, naturalRoll: 10, critical: false };
      const mockRoll2 = { total: 7, naturalRoll: 5, critical: false };

      (DiceEngine.roll as any).mockReturnValueOnce(mockRoll1).mockReturnValueOnce(mockRoll2);

      const result = await executeAllNPCRolls(requests);

      expect(result.npcRolls).toHaveLength(2);
      expect(result.playerRolls).toHaveLength(1);
      expect(result.npcRolls[0].request.actorName).toBe('NPC 1');
      expect(result.npcRolls[1].request.actorName).toBe('NPC 2');
      expect(result.playerRolls[0].purpose).toBe('Player 1');
    });

    it('should continue processing even if one NPC roll fails', async () => {
      const requests: RollRequest[] = [
        { type: 'attack', formula: 'fail', purpose: 'Fail', autoExecute: true },
        { type: 'attack', formula: 'success', purpose: 'Success', autoExecute: true },
      ];

      (DiceEngine.roll as any)
        .mockImplementationOnce(() => {
          throw new Error('Fail');
        })
        .mockReturnValueOnce({ total: 10 });

      const result = await executeAllNPCRolls(requests);

      expect(result.npcRolls).toHaveLength(1);
      expect(result.npcRolls[0].request.formula).toBe('success');
    });
  });

  describe('formatNPCRollResult', () => {
    it('should format attack hits correctly', () => {
      const autoRoll = {
        request: { type: 'attack', purpose: 'Greataxe', ac: 15, actorName: 'Orc' } as RollRequest,
        result: { total: 18, naturalRoll: 13, critical: false } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toContain('Orc Greataxe: **18** **hits** (AC 15)');
    });

    it('should format attack misses correctly', () => {
      const autoRoll = {
        request: { type: 'attack', purpose: 'Greataxe', ac: 15, actorName: 'Orc' } as RollRequest,
        result: { total: 12, naturalRoll: 7, critical: false } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toContain('Orc Greataxe: **12** **misses** (AC 15)');
    });

    it('should format critical hits correctly', () => {
      const autoRoll = {
        request: { type: 'attack', purpose: 'Greataxe', actorName: 'Orc' } as RollRequest,
        result: { total: 25, naturalRoll: 20, critical: true } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toContain('**25**');
      expect(output).toContain('**CRITICAL HIT!**');
    });

    it('should format critical misses correctly', () => {
      const autoRoll = {
        request: { type: 'attack', purpose: 'Greataxe', actorName: 'Orc' } as RollRequest,
        result: { total: 6, naturalRoll: 1, critical: false } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toContain('**6**');
      expect(output).toContain('**Critical Miss!**');
    });

    it('should format damage rolls correctly', () => {
      const autoRoll = {
        request: { type: 'damage', purpose: 'Fireball damage', actorName: 'Mage' } as RollRequest,
        result: { total: 28 } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toBe('🎲 Mage Fireball damage: **28** damage');
    });

    it('should format save successes correctly', () => {
      const autoRoll = {
        request: { type: 'save', purpose: 'Dex Save', dc: 15, actorName: 'Rogue' } as RollRequest,
        result: { total: 17 } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toContain('Rogue Dex Save: **17** **succeeds** (DC 15)');
    });

    it('should format save failures correctly', () => {
      const autoRoll = {
        request: { type: 'save', purpose: 'Con Save', dc: 12, actorName: 'Zombie' } as RollRequest,
        result: { total: 8 } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toContain('Zombie Con Save: **8** **fails** (DC 12)');
    });

    it('should format initiative correctly', () => {
      const autoRoll = {
        request: { type: 'initiative', actorName: 'Wolf' } as RollRequest,
        result: { total: 14 } as any,
        timestamp: new Date(),
      };

      const output = formatNPCRollResult(autoRoll);
      expect(output).toBe('🎲 Wolf Initiative: **14**');
    });
  });

  describe('isAttackHit', () => {
    it('should return true if total >= ac', () => {
      const autoRoll = {
        request: { type: 'attack', ac: 15 } as RollRequest,
        result: { total: 15 } as any,
      };
      expect(isAttackHit(autoRoll as any)).toBe(true);
    });

    it('should return false if total < ac', () => {
      const autoRoll = {
        request: { type: 'attack', ac: 15 } as RollRequest,
        result: { total: 14 } as any,
      };
      expect(isAttackHit(autoRoll as any)).toBe(false);
    });

    it('should return false if not an attack', () => {
      const autoRoll = {
        request: { type: 'save', ac: 15 } as RollRequest,
        result: { total: 20 } as any,
      };
      expect(isAttackHit(autoRoll as any)).toBe(false);
    });
  });

  describe('isCheckSuccess', () => {
    it('should return true if total >= dc', () => {
      const autoRoll = {
        request: { dc: 15 } as RollRequest,
        result: { total: 15 } as any,
      };
      expect(isCheckSuccess(autoRoll as any)).toBe(true);
    });

    it('should return false if total < dc', () => {
      const autoRoll = {
        request: { dc: 15 } as RollRequest,
        result: { total: 14 } as any,
      };
      expect(isCheckSuccess(autoRoll as any)).toBe(false);
    });

    it('should return false if no dc', () => {
      const autoRoll = {
        request: { type: 'check' } as RollRequest,
        result: { total: 20 } as any,
      };
      expect(isCheckSuccess(autoRoll as any)).toBe(false);
    });
  });
});

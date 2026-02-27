/* eslint-disable @typescript-eslint/no-explicit-any */
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

vi.mock('@/services/combat/rollStateManager', () => ({
  rollStateManager: {
    isAwaitingDamage: vi.fn(),
    getAwaitingDamageRoll: vi.fn(),
    addPendingRoll: vi.fn(),
  },
}));

vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    createDamageRollRequest: vi.fn(),
  },
}));

vi.mock('@/services/combat/npc-auto-roller', () => ({
  executeAllNPCRolls: vi.fn(),
}));

vi.mock('@/services/ai/npc-roll-handler', () => ({
  continueNarrativeWithNPCRolls: vi.fn(),
  formatNPCRollsSystemMessage: vi.fn(),
}));

vi.mock('@/utils/rollRequestParser', () => ({
  parseRollRequests: vi.fn(),
  detectsSuccessfulAttack: vi.fn(),
  detectsCriticalHit: vi.fn(),
}));

import {
  pruneProcessedSet,
  deduplicateRollRequests,
  parseAndAugmentRollRequests,
  processRollRequests
} from '../roll-processor';
import { rollStateManager } from '@/services/combat/rollStateManager';
import { DiceEngine } from '@/services/dice/DiceEngine';
import * as npcAutoRoller from '@/services/combat/npc-auto-roller';
import * as npcRollHandler from '@/services/ai/npc-roll-handler';
import { parseRollRequests, detectsSuccessfulAttack, detectsCriticalHit } from '@/utils/rollRequestParser';

describe('roll-processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pruneProcessedSet', () => {
    it('should prune the set when it exceeds MAX_PROCESSED_ROLLS', () => {
      const set = new Set<string>();
      for (let i = 0; i < 110; i++) {
        set.add(`sig-${i}`);
      }

      pruneProcessedSet(set);

      expect(set.size).toBe(50);
      expect(set.has('sig-0')).toBe(false);
      expect(set.has('sig-109')).toBe(true);
    });

    it('should NOT prune if below limit', () => {
      const set = new Set<string>();
      for (let i = 0; i < 90; i++) {
        set.add(`sig-${i}`);
      }

      pruneProcessedSet(set);

      expect(set.size).toBe(90);
    });
  });

  describe('deduplicateRollRequests', () => {
    it('should filter out duplicate requests based on signature', () => {
      const set = new Set<string>();
      set.add('Attack|1d20+5||15'); // Fixed signature: purpose|formula|dc|ac

      const requests: any[] = [
        { purpose: 'Attack', formula: '1d20+5', ac: 15 }, // Duplicate
        { purpose: 'Damage', formula: '1d8+3' },        // New
      ];

      const result = deduplicateRollRequests(requests, set);

      expect(result).toHaveLength(1);
      expect(result[0].purpose).toBe('Damage');
      expect(set.has('Damage|1d8+3||')).toBe(true);
    });
  });

  describe('parseAndAugmentRollRequests', () => {
    it('should parse from text if existingRequests is empty', () => {
      const responseText = 'Roll for initiative!';
      (parseRollRequests as any).mockReturnValue([{ type: 'initiative', formula: '1d20+2', purpose: 'Initiative' }]);

      const result = parseAndAugmentRollRequests(responseText, []);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('initiative');
    });

    it('should add automatic damage roll on successful attack if awaiting damage', () => {
      const responseText = 'Your longsword hits the goblin!';
      (detectsSuccessfulAttack as any).mockReturnValue(true);
      (detectsCriticalHit as any).mockReturnValue(false);
      (rollStateManager.isAwaitingDamage as any).mockReturnValue(true);
      (rollStateManager.getAwaitingDamageRoll as any).mockReturnValue({ type: 'attack' });
      (DiceEngine.createDamageRollRequest as any).mockReturnValue({ formula: '1d8+3', purpose: 'Longsword damage' });

      const result = parseAndAugmentRollRequests(responseText, []);

      // One for the parsed hit (if any, mocked here as empty), plus one for auto-damage
      // Actually parseRollRequests is called and we mock it to return nothing
      (parseRollRequests as any).mockReturnValue([]);

      const augmented = parseAndAugmentRollRequests(responseText, []);
      expect(augmented).toHaveLength(1);
      expect(augmented[0].type).toBe('damage');
      expect(augmented[0].formula).toBe('1d8+3');
    });
  });

  describe('processRollRequests', () => {
    it('should separate NPC rolls and execute them', async () => {
      const params = {
        responseText: 'The goblin attacks!',
        existingRequests: [],
        isDiceRollMessage: false,
        processedSet: new Set<string>(),
        aiContext: {},
        sessionId: 'session-123',
        characterId: 'player-1',
      };

      (parseRollRequests as any).mockReturnValue([{ type: 'attack', formula: '1d20+4', purpose: 'Goblin attack', ac: 15 }]);
      (npcAutoRoller.executeAllNPCRolls as any).mockResolvedValue({
        npcRolls: [{ type: 'attack', result: 18, purpose: 'Goblin attack' }],
        playerRolls: []
      });
      (npcRollHandler.continueNarrativeWithNPCRolls as any).mockResolvedValue({
        success: true,
        narrative: 'The goblin swings and misses!'
      });

      const result = await processRollRequests(params);

      expect(result.npcRollResults).toHaveLength(1);
      expect(result.playerRollRequests).toHaveLength(0);
      expect(result.npcRollContinuationText).toBe('The goblin swings and misses!');
    });

    it('should suppress requests if isDiceRollMessage is true', async () => {
      const params = {
        responseText: 'You hit!',
        existingRequests: [{ type: 'damage', formula: '1d8', purpose: 'Damage' }],
        isDiceRollMessage: true,
        processedSet: new Set<string>(),
        aiContext: {},
        sessionId: 'session-123',
        characterId: 'player-1',
      };

      const result = await processRollRequests(params);

      expect(result.playerRollRequests).toHaveLength(0);
    });

    it('should track player attacks in rollStateManager', async () => {
      const params = {
        responseText: 'Roll an attack!',
        existingRequests: [{ type: 'attack', formula: '1d20+5', purpose: 'My attack', ac: 14 }],
        isDiceRollMessage: false,
        processedSet: new Set<string>(),
        aiContext: {},
        sessionId: 'session-123',
        characterId: 'player-1',
      };

      (npcAutoRoller.executeAllNPCRolls as any).mockResolvedValue({
        npcRolls: [],
        playerRolls: params.existingRequests
      });

      await processRollRequests(params);

      expect(rollStateManager.addPendingRoll).toHaveBeenCalledWith(expect.objectContaining({
        type: 'attack',
        targetAC: 14,
        actorId: 'player-1'
      }));
    });
  });
});

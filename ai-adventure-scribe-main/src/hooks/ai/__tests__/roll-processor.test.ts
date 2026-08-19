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
  processRollRequests,
  dropInCombatAttackRequests,
} from '../roll-processor';

import * as npcRollHandler from '@/services/ai/npc-roll-handler';
import * as npcAutoRoller from '@/services/combat/npc-auto-roller';
import { rollStateManager } from '@/services/combat/rollStateManager';
import { DiceEngine } from '@/services/dice/DiceEngine';
import {
  parseRollRequests,
  detectsSuccessfulAttack,
  detectsCriticalHit,
} from '@/utils/rollRequestParser';

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
        { purpose: 'Damage', formula: '1d8+3' }, // New
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
      (parseRollRequests as any).mockReturnValue([
        { type: 'initiative', formula: '1d20+2', purpose: 'Initiative' },
      ]);

      const result = parseAndAugmentRollRequests(responseText, []);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('initiative');
    });

    // Regression test for the "dice rolls never trigger" bug: when the DM's
    // structured response already contains roll_requests (e.g. a Perception
    // check attached by the model per the updated dm system prompt), those
    // must be used directly and the legacy text-fence parser must NOT run -
    // it previously only ever activated as a fallback for empty
    // existingRequests, so this asserts that fallback path stays a fallback.
    it('should use structured existingRequests as-is and skip legacy text parsing entirely', () => {
      const responseText = 'You crouch low, scanning the dining room for anything out of place.';
      const structuredRequest = {
        type: 'check',
        formula: '1d20+wis',
        purpose: "Perception check to survey the dining room with a ranger's instincts",
        dc: 13,
        ac: null,
        advantage: false,
        disadvantage: false,
      };

      const result = parseAndAugmentRollRequests(responseText, [structuredRequest as any]);

      expect(parseRollRequests).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'check',
        formula: '1d20+wis',
        dc: 13,
        ac: null,
      });
    });

    it('should add automatic damage roll on successful attack if awaiting damage', () => {
      const responseText = 'Your longsword hits the goblin!';
      (detectsSuccessfulAttack as any).mockReturnValue(true);
      (detectsCriticalHit as any).mockReturnValue(false);
      (rollStateManager.isAwaitingDamage as any).mockReturnValue(true);
      (rollStateManager.getAwaitingDamageRoll as any).mockReturnValue({ type: 'attack' });
      (DiceEngine.createDamageRollRequest as any).mockReturnValue({
        formula: '1d8+3',
        purpose: 'Longsword damage',
      });

      const _result = parseAndAugmentRollRequests(responseText, []);

      // One for the parsed hit (if any, mocked here as empty), plus one for auto-damage
      // Actually parseRollRequests is called and we mock it to return nothing
      (parseRollRequests as any).mockReturnValue([]);

      const augmented = parseAndAugmentRollRequests(responseText, []);
      expect(augmented).toHaveLength(1);
      expect(augmented[0].type).toBe('damage');
      expect(augmented[0].formula).toBe('1d8+3');
    });
  });

  describe('dropInCombatAttackRequests', () => {
    it('drops attack requests during combat so a second popup cannot discard the first roll', () => {
      const kept = dropInCombatAttackRequests(
        [
          {
            type: 'attack',
            formula: '1d20-1',
            purpose: 'The Storyteller punches Dishwasher Prime',
          },
          { type: 'check', formula: '1d20+wis', purpose: 'Perception check' },
        ],
        { gameState: { isInCombat: true } },
      );
      expect(kept).toHaveLength(1);
      expect(kept[0].type).toBe('check');
    });

    it('leaves exploration attacks alone when combat is not active', () => {
      const requests = [{ type: 'attack', formula: '1d20+4', purpose: 'Longsword attack' }];
      expect(dropInCombatAttackRequests(requests, { gameState: { isInCombat: false } })).toEqual(
        requests,
      );
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

      (parseRollRequests as any).mockReturnValue([
        { type: 'attack', formula: '1d20+4', purpose: 'Goblin attack', ac: 15 },
      ]);
      (npcAutoRoller.executeAllNPCRolls as any).mockResolvedValue({
        npcRolls: [{ type: 'attack', result: 18, purpose: 'Goblin attack' }],
        playerRolls: [],
      });
      (npcRollHandler.continueNarrativeWithNPCRolls as any).mockResolvedValue({
        success: true,
        narrative: 'The goblin swings and misses!',
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

    // Regression test: a structured DM response carrying a roll_requests entry
    // (the schema field, as opposed to a legacy ROLL_REQUESTS_V1 text fence)
    // must reach the player roll flow end-to-end through processRollRequests.
    it('should carry a structured roll_requests entry through to playerRollRequests', async () => {
      const structuredRequest = {
        type: 'check',
        formula: '1d20+wis',
        purpose: 'Perception check to survey the dining room',
        dc: 13,
        ac: null,
        advantage: false,
        disadvantage: false,
      };
      const params = {
        responseText: 'You crouch low, scanning the dining room for anything out of place.',
        existingRequests: [structuredRequest as any],
        isDiceRollMessage: false,
        processedSet: new Set<string>(),
        aiContext: {},
        sessionId: 'session-123',
        characterId: 'player-1',
      };

      (npcAutoRoller.executeAllNPCRolls as any).mockResolvedValue({
        npcRolls: [],
        playerRolls: params.existingRequests,
      });

      const result = await processRollRequests(params);

      expect(parseRollRequests).not.toHaveBeenCalled();
      expect(result.playerRollRequests).toHaveLength(1);
      expect(result.playerRollRequests[0]).toMatchObject({
        type: 'check',
        purpose: 'Perception check to survey the dining room',
        dc: 13,
        ac: null,
      });
    });

    it('should preserve target AC from a structured attack request', () => {
      const structuredAttack = {
        type: 'attack',
        formula: '1d20+5',
        purpose: 'Longsword attack against the goblin',
        dc: null,
        ac: 15,
        advantage: false,
        disadvantage: false,
      };

      const result = parseAndAugmentRollRequests('You raise your longsword.', [
        structuredAttack as any,
      ]);

      expect(result[0].ac).toBe(15);
    });

    // Regression test: legacy ROLL_REQUESTS_V1 text-fence responses (from
    // providers/paths that don't populate the structured field) must still
    // parse via the fallback text parser.
    it('should still fall back to legacy text-fence parsing when existingRequests is empty', async () => {
      const legacyParsedRequest = {
        type: 'check',
        formula: '1d20+dex',
        purpose: 'Stealth check to avoid detection',
        dc: 14,
      };
      (parseRollRequests as any).mockReturnValue([legacyParsedRequest]);
      (npcAutoRoller.executeAllNPCRolls as any).mockResolvedValue({
        npcRolls: [],
        playerRolls: [legacyParsedRequest],
      });

      const params = {
        responseText:
          'The shadows deepen.\n```ROLL_REQUESTS_V1\n{"rolls":[{"type":"check","formula":"1d20+dex","purpose":"Stealth check to avoid detection","dc":14}]}\n```',
        existingRequests: [],
        isDiceRollMessage: false,
        processedSet: new Set<string>(),
        aiContext: {},
        sessionId: 'session-123',
        characterId: 'player-1',
      };

      const result = await processRollRequests(params);

      expect(parseRollRequests).toHaveBeenCalledWith(params.responseText);
      expect(result.playerRollRequests).toHaveLength(1);
      expect(result.playerRollRequests[0]).toMatchObject({
        type: 'check',
        purpose: 'Stealth check to avoid detection',
      });
    });

    it('passes the encounter roster so NPC attacks can be classified without autoExecute', async () => {
      const params = {
        responseText: 'Brigade Warrior 2 lunges.',
        existingRequests: [
          {
            type: 'attack',
            formula: '1d20+4',
            purpose: 'Brigade Warrior 2 attacks The Faithful',
            autoExecute: false,
          },
        ],
        isDiceRollMessage: false,
        processedSet: new Set<string>(),
        aiContext: {
          gameState: {
            participants: [
              { id: 'faithful-id', name: 'The Faithful', type: 'player' },
              { id: 'brigade-2', name: 'Brigade Warrior 2', type: 'enemy' },
            ],
          },
        },
        sessionId: 'session-123',
        characterId: 'player-1',
      };

      (npcAutoRoller.executeAllNPCRolls as any).mockResolvedValue({
        npcRolls: [{ request: params.existingRequests[0], result: { total: 6 } }],
        playerRolls: [],
      });
      (npcRollHandler.continueNarrativeWithNPCRolls as any).mockResolvedValue({
        success: true,
        narrative: 'The warrior swings and misses.',
      });

      const result = await processRollRequests(params as any);

      expect(npcAutoRoller.executeAllNPCRolls).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'attack',
            purpose: 'Brigade Warrior 2 attacks The Faithful',
          }),
        ]),
        [
          { id: 'faithful-id', name: 'The Faithful', participantType: 'player' },
          { id: 'brigade-2', name: 'Brigade Warrior 2', participantType: 'enemy' },
        ],
      );
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
        playerRolls: params.existingRequests,
      });

      await processRollRequests(params);

      expect(rollStateManager.addPendingRoll).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'attack',
          targetAC: 14,
          actorId: 'player-1',
        }),
      );
    });
  });
});

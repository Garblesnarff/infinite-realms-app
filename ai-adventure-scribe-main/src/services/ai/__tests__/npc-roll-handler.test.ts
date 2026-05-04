/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { continueNarrativeWithNPCRolls, formatNPCRollsSystemMessage } from '../npc-roll-handler';

import { AIService } from '@/services/ai-service';


vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('NPCRollHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('continueNarrativeWithNPCRolls', () => {
    const mockAiContext = { key: 'value' };
    const sessionId = 'session-123';

    it('should return empty narrative for empty rolls', async () => {
      const result = await continueNarrativeWithNPCRolls([], mockAiContext, sessionId);
      expect(result).toEqual({
        narrative: '',
        success: true,
      });
      expect(AIService.chatWithDM).not.toHaveBeenCalled();
    });

    it('should call AIService with correctly formatted continuation prompt for attack rolls', async () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Goblin',
            purpose: 'attacks the Fighter',
            type: 'attack',
            formula: '1d20+4',
            ac: 15
          },
          result: {
            total: 18,
            naturalRoll: 14,
            rolls: [{ dice: 20, value: 14 }],
            critical: false
          }
        }
      ];

      (AIService.chatWithDM as any).mockResolvedValue({ text: 'The goblin swings and hits the fighter.' });

      const result = await continueNarrativeWithNPCRolls(rolls, mockAiContext, sessionId);

      expect(result.success).toBe(true);
      expect(result.narrative).toBe('The goblin swings and hits the fighter.');
      expect(AIService.chatWithDM).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('**Goblin** attacks the Fighter:'),
        context: expect.objectContaining({
          ...mockAiContext,
          systemInstruction: 'NPC_ROLL_CONTINUATION',
          npcRollResults: expect.arrayContaining([
            expect.objectContaining({
              actor: 'Goblin',
              hitOrMiss: 'HIT'
            })
          ])
        }),
        sessionId
      }));
    });

    it('should handle result.response fallback from AIService', async () => {
      const rolls: any[] = [
        {
          request: { purpose: 'test', type: 'check' },
          result: { total: 10, rolls: [] }
        }
      ];

      (AIService.chatWithDM as any).mockResolvedValue({ response: 'Response text' });

      const result = await continueNarrativeWithNPCRolls(rolls, mockAiContext, sessionId);
      expect(result.narrative).toBe('Response text');
    });

    it('should handle missing actor name and natural roll in prompt generation', async () => {
      const rolls: any[] = [
        {
          request: {
            purpose: 'mysterious action',
            type: 'check'
          },
          result: {
            total: 15,
            rolls: [{ dice: 20, value: 15 }],
            critical: false
          }
        }
      ];

      (AIService.chatWithDM as any).mockResolvedValue({ text: 'Something happens.' });

      await continueNarrativeWithNPCRolls(rolls, mockAiContext, sessionId);

      expect(AIService.chatWithDM).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('**NPC** mysterious action:')
      }));
    });

    it('should handle critical hits in prompt generation', async () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Orc',
            purpose: 'greataxe attack',
            type: 'attack',
            formula: '1d20+5',
            ac: 10
          },
          result: {
            total: 25,
            naturalRoll: 20,
            rolls: [{ dice: 20, value: 20 }],
            critical: true
          }
        }
      ];

      (AIService.chatWithDM as any).mockResolvedValue({ text: 'Critical hit!' });

      await continueNarrativeWithNPCRolls(rolls, mockAiContext, sessionId);

      expect(AIService.chatWithDM).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('**CRITICAL!**')
      }));
    });

    it('should handle saves and checks with DC', async () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Mage',
            purpose: 'Fireball Save',
            type: 'save',
            formula: '1d20+2',
            dc: 15
          },
          result: {
            total: 12,
            naturalRoll: 10,
            rolls: [{ dice: 20, value: 10 }],
            critical: false
          }
        }
      ];

      (AIService.chatWithDM as any).mockResolvedValue({ text: 'The mage fails to dodge.' });

      await continueNarrativeWithNPCRolls(rolls, mockAiContext, sessionId);

      expect(AIService.chatWithDM).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('vs DC 15: **FAIL**')
      }));
    });

    it('should return fallback narrative when AIService fails', async () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Goblin',
            purpose: 'attack',
            type: 'attack',
            ac: 15
          },
          result: {
            total: 18,
            rolls: []
          }
        },
        {
          request: {
            actorName: 'Skeleton',
            purpose: 'attack',
            type: 'attack',
            ac: 15
          },
          result: {
            total: 10,
            rolls: []
          }
        },
        {
          request: {
            actorName: 'Boss',
            purpose: 'smash',
            type: 'damage'
          },
          result: {
            total: 10,
            rolls: []
          }
        },
        {
          request: {
            purpose: 'generic action',
            type: 'check'
          },
          result: {
            total: 12,
            rolls: []
          }
        }
      ];

      (AIService.chatWithDM as any).mockRejectedValue(new Error('AI error'));

      const result = await continueNarrativeWithNPCRolls(rolls, mockAiContext, sessionId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('AI error');
      expect(result.narrative).toContain('Goblin attacks (rolled 18) and hits!');
      expect(result.narrative).toContain('Skeleton attacks (rolled 10) and misses!');
      expect(result.narrative).toContain('Boss deals 10 damage!');
      expect(result.narrative).toContain('The enemy rolls 12 for generic action.');
    });

    it('should handle non-Error catch block', async () => {
      const rolls: any[] = [
        {
          request: { purpose: 'test', type: 'check' },
          result: { total: 10, rolls: [] }
        }
      ];
      (AIService.chatWithDM as any).mockRejectedValue('String error');
      const result = await continueNarrativeWithNPCRolls(rolls, mockAiContext, sessionId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('formatNPCRollsSystemMessage', () => {
    it('should return empty string for empty rolls', () => {
      const result = formatNPCRollsSystemMessage([]);
      expect(result).toBe('');
    });

    it('should format attack rolls correctly (HIT)', () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Goblin',
            purpose: 'attack',
            type: 'attack',
            ac: 15
          },
          result: {
            total: 18,
            naturalRoll: 14,
            critical: false
          }
        }
      ];

      const result = formatNPCRollsSystemMessage(rolls);
      expect(result).toContain('Goblin** attack: 18');
      expect(result).toContain('(**hits** AC 15)');
    });

    it('should format attack rolls correctly (MISS)', () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Goblin',
            purpose: 'attack',
            type: 'attack',
            ac: 15
          },
          result: {
            total: 12,
            naturalRoll: 8,
            critical: false
          }
        }
      ];

      const result = formatNPCRollsSystemMessage(rolls);
      expect(result).toContain('Goblin** attack: 12');
      expect(result).toContain('(misses AC 15)');
    });

    it('should format critical hits and fumbles', () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Orc',
            purpose: 'attack',
            type: 'attack'
          },
          result: {
            total: 25,
            naturalRoll: 20,
            critical: true
          }
        },
        {
          request: {
            actorName: 'Kobold',
            purpose: 'attack',
            type: 'attack'
          },
          result: {
            total: 2,
            naturalRoll: 1,
            critical: false
          }
        }
      ];

      const result = formatNPCRollsSystemMessage(rolls);
      expect(result).toContain('**CRITICAL!**');
      expect(result).toContain('**Fumble!**');
    });

    it('should format DC checks correctly (succeeds and fails)', () => {
      const rolls: any[] = [
        {
          request: {
            actorName: 'Trap',
            purpose: 'Poison',
            dc: 14
          },
          result: {
            total: 15
          }
        },
        {
          request: {
            actorName: 'Door',
            purpose: 'Lock',
            dc: 20
          },
          result: {
            total: 5
          }
        }
      ];

      const result = formatNPCRollsSystemMessage(rolls);
      expect(result).toContain('(**succeeds** DC 14)');
      expect(result).toContain('(fails DC 20)');
    });

    it('should use default NPC actor name if missing', () => {
      const rolls: any[] = [
        {
          request: { purpose: 'generic', type: 'check' },
          result: { total: 10 }
        }
      ];
      const result = formatNPCRollsSystemMessage(rolls);
      expect(result).toContain('**NPC** generic: 10');
    });
  });
});

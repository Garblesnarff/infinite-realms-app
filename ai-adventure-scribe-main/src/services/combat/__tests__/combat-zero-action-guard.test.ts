/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildZeroActionRepairPrompt,
  extractBoardRoster,
  looksLikeCombatActionAttempt,
  repairZeroActionCombatTurn,
  shouldForceCombatAction,
} from '../combat-zero-action-guard';

import { AIService } from '@/services/ai-service';

/**
 * The turn the DM narrated instead of declaring.
 *
 * Production 2026-08-10 17:29: "I attack the Sentient Glaze with my claws" produced a
 * structured attack, an intent POST, and an engine-resolved outcome. 22:38, same session, the
 * *same sentence*: `actions:0`, no POST, and a miss narrated in prose that no die was ever
 * rolled for. The prompt already forbids exactly this; the model complies about half the time.
 * The guard turns the instruction into a check.
 */

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const TACTICAL_CONTEXT = `ACTIVE the-seeker
the-seeker@2,4 hp:18/24
sentient-glaze@8,5 hp:30/30

<turn_order round="3">
→ 1. the-seeker | The Seeker | 18/24 HP | action:available | CURRENT TURN
  2. sentient-glaze | Sentient Glaze | 30/30 HP | action:available
</turn_order>`;

describe('the zero-action combat guard', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('recognising that the player tried to act', () => {
    it('fires on the production input that produced no action', () => {
      expect(looksLikeCombatActionAttempt('I attack the Sentient Glaze with my claws')).toBe(true);
    });

    it('reads through the padding players actually type', () => {
      for (const input of [
        "I'll swing my axe at the glaze",
        'I try to stab it',
        'I am going to cast fire bolt at the glaze',
        'We charge the thing',
        'attack the glaze',
        'Cast magic missile at it',
      ]) {
        expect(looksLikeCombatActionAttempt(input), input).toBe(true);
      }
    });

    it('stands down for questions and hypotheticals, which are not attempts', () => {
      // Forcing an action out of these would take the player's turn for them.
      for (const input of [
        'Can I attack from here?',
        'What if I attack it instead',
        'Should I cast fireball',
        'How do I attack the glaze',
        'What does the glaze look like?',
      ]) {
        expect(looksLikeCombatActionAttempt(input), input).toBe(false);
      }
    });

    it('stands down for combat input that is not an action to resolve', () => {
      for (const input of [
        'I move behind the pillar',
        'I look at the sentient glaze',
        'I talk to the seeker',
        '',
        undefined,
      ]) {
        expect(looksLikeCombatActionAttempt(input as any), String(input)).toBe(false);
      }
    });
  });

  describe('deciding whether the turn owed the engine an action', () => {
    const attempt = {
      isInCombat: true,
      hasActiveEncounter: true,
      result: { text: 'Your claws rake across the glaze.' },
      playerMessage: 'I attack the Sentient Glaze with my claws',
    };

    it('fires on the turn that dropped the action', () => {
      expect(shouldForceCombatAction(attempt)).toBe(true);
    });

    it('stands down for every reason firing would be worse than the bug', () => {
      const standDowns: Array<[string, Record<string, unknown>]> = [
        ['not in combat', { isInCombat: false }],
        ['no active encounter', { hasActiveEncounter: false }],
        ['the DM did declare an action', { result: { combat_actions: [{}] } }],
        ['the board is moving', { result: { combat_transition: 'start' } }],
        ['the DM asked for a roll', { result: { roll_requests: [{}] } }],
        ['a legacy roll block', { result: { text: '```ROLL_REQUESTS_V1\nx\n```' } }],
        ['a submitted dice result', { isDiceRollMessage: true }],
        ['the player asked a question', { playerMessage: 'Can I attack it?' }],
      ];
      for (const [why, override] of standDowns) {
        expect(shouldForceCombatAction({ ...attempt, ...override } as any), why).toBe(false);
      }
    });
  });

  describe('the roster read back off the board', () => {
    it('takes the turn order block and the current-turn slug verbatim', () => {
      const roster = extractBoardRoster(TACTICAL_CONTEXT);

      expect(roster.currentSlug).toBe('the-seeker');
      expect(roster.turnOrder).toContain('<turn_order round="3">');
      expect(roster.turnOrder).toContain('sentient-glaze | Sentient Glaze');
    });

    it('falls back to the digest ACTIVE line when no turn order block was built', () => {
      // buildTurnOrderBlock degrades to '' on any failure; the digest still names the actor.
      expect(extractBoardRoster('ACTIVE sentient-glaze\nsentient-glaze@8,5').currentSlug).toBe(
        'sentient-glaze',
      );
    });

    it('reports no roster rather than inventing one', () => {
      expect(extractBoardRoster(undefined)).toEqual({ turnOrder: null, currentSlug: null });
    });
  });

  describe('the correction handed to the DM', () => {
    it('states that nothing was resolved, attaches the board, and demands a structured action', () => {
      const prompt = buildZeroActionRepairPrompt(
        'I attack the Sentient Glaze with my claws',
        extractBoardRoster(TACTICAL_CONTEXT),
        'Your claws rake across the glaze and skitter away.',
      );

      expect(prompt).toContain('YOUR LAST RESPONSE RESOLVED NOTHING');
      expect(prompt).toContain('I attack the Sentient Glaze with my claws');
      expect(prompt).toContain('The entity whose turn it is: the-seeker.');
      expect(prompt).toContain('<turn_order round="3">');
      expect(prompt).toContain('MUST return at least one entry in combat_actions');
      // The engine decides the outcome; a re-narrated hit would be the same bug twice.
      expect(prompt).toContain('do not state a hit');
      expect(prompt).toContain('Do not mention this correction');
    });

    it('omits the board lines it does not have instead of printing empty ones', () => {
      const prompt = buildZeroActionRepairPrompt('I attack it', {
        turnOrder: null,
        currentSlug: null,
      });

      expect(prompt).not.toContain('The entity whose turn it is');
      expect(prompt).not.toContain('The board:');
      expect(prompt).toContain('MUST return at least one entry in combat_actions');
    });
  });

  describe('the regeneration', () => {
    const params = (): Record<string, unknown> => ({
      playerMessage: 'I attack the Sentient Glaze with my claws',
      narratedText: 'Your claws rake across the glaze.',
      roster: extractBoardRoster(TACTICAL_CONTEXT),
      aiContext: { sessionId: 'session-123' },
      conversationHistory: [],
    });

    it('asks the DM once and returns the action it should have declared', async () => {
      vi.mocked(AIService.chatWithDM).mockResolvedValue({
        text: 'You lash out at the glaze.',
        combat_actions: [
          { actor_id: 'the-seeker', action_type: 'attack', target_ids: ['sentient-glaze'] },
        ],
      } as any);

      const repaired = await repairZeroActionCombatTurn(params() as any);

      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
      expect(repaired?.combat_actions?.[0].actor_id).toBe('the-seeker');
      expect(repaired?.combat_actions?.[0].target_ids).toEqual(['sentient-glaze']);
    });

    it('returns the regeneration even when the DM still declares nothing, so the caller can log it', async () => {
      vi.mocked(AIService.chatWithDM).mockResolvedValue({
        text: 'The glaze pulses, unharmed.',
        combat_actions: [],
      } as any);

      const repaired = await repairZeroActionCombatTurn(params() as any);

      expect(repaired?.combat_actions).toEqual([]);
      // Exactly one chance, matching the refusal repair's budget.
      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    });

    it('returns null when the regeneration itself fails, leaving the original narration', async () => {
      vi.mocked(AIService.chatWithDM).mockRejectedValue(new Error('provider down'));

      expect(await repairZeroActionCombatTurn(params() as any)).toBeNull();
      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    });
  });
});

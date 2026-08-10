/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CombatIntentRefusedError } from '../combat-action-executor';
import { buildRepairPrompt, repairRefusedCombatAction } from '../combat-repair';

import { AIService } from '@/services/ai-service';

/**
 * The turn the engine refused, asked again.
 *
 * Production 2026-08-10 17:36: the DM declared an attack for `the-seeker` while
 * `sentient-glaze` held the turn. The engine answered 422 "Actor is not the current-turn
 * participant" — correctly — and the client turned that into a raw error in the player's chat.
 * The refusal already knew everything needed to fix itself: whose turn it was, and what was on
 * the board. It was thrown away one line after arriving.
 */

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const REFUSED_ACTION: any = {
  actor_id: 'the-seeker',
  action_type: 'attack',
  target_ids: ['sentient-glaze'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const outOfTurn = () =>
  new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {
    currentParticipantId: '699eb395-c30c-4dcd-9d25-e1208c780740',
    currentParticipantSlug: 'sentient-glaze',
    roster: 'the-seeker@2,4, sentient-glaze@8,5',
  });

const params = (refusal: CombatIntentRefusedError) => ({
  refusal,
  refusedAction: REFUSED_ACTION,
  aiContext: { sessionId: 'session-123' },
  conversationHistory: [],
});

describe('combat repair after an engine refusal', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('the correction handed to the DM', () => {
    it('states the refusal, the board, and whose turn it actually is', () => {
      const prompt = buildRepairPrompt(outOfTurn(), REFUSED_ACTION);

      expect(prompt).toContain('ENGINE REFUSED YOUR LAST COMBAT ACTION');
      expect(prompt).toContain('Actor is not the current-turn participant');
      expect(prompt).toContain('attack by "the-seeker"');
      expect(prompt).toContain('sentient-glaze');
      expect(prompt).toContain('the-seeker@2,4, sentient-glaze@8,5');
      // The player must never learn the machine argued with itself.
      expect(prompt).toContain('Do not mention this correction');
    });

    it('names an unresolvable reference when that is what missed', () => {
      const refusal = new CombatIntentRefusedError('Combat participant not found', 404, {
        role: 'target',
        id: 'the-marrow-king',
        roster: 'the-seeker@2,4, sentient-glaze@8,5',
      });

      expect(buildRepairPrompt(refusal, REFUSED_ACTION)).toContain(
        'The target reference "the-marrow-king" named nothing on the board',
      );
    });
  });

  describe('the regeneration', () => {
    it('asks the DM once and returns the corrected actions', async () => {
      vi.mocked(AIService.chatWithDM).mockResolvedValue({
        text: 'The glaze surges, pseudopod lashing.',
        combat_actions: [{ ...REFUSED_ACTION, actor_id: 'sentient-glaze' }],
      } as any);

      const repaired = await repairRefusedCombatAction(params(outOfTurn()) as any);

      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
      expect(repaired?.combat_actions?.[0].actor_id).toBe('sentient-glaze');
      expect(repaired?.text).toContain('glaze surges');
    });

    it('returns null rather than retrying when the refusal is not the DM’s to fix', async () => {
      const conflict = new CombatIntentRefusedError('Encounter version conflict', 409, {});

      expect(await repairRefusedCombatAction(params(conflict) as any)).toBeNull();
      // A 409 is a stale read, not a bad declaration; re-asking the model cannot resolve it.
      expect(AIService.chatWithDM).not.toHaveBeenCalled();
    });

    it('returns null when the regeneration itself fails, so the caller can surface the original', async () => {
      vi.mocked(AIService.chatWithDM).mockRejectedValue(new Error('provider down'));

      expect(await repairRefusedCombatAction(params(outOfTurn()) as any)).toBeNull();
      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    });
  });

  describe('the refusal error itself', () => {
    it('carries status and details instead of flattening to a message', () => {
      const refusal = outOfTurn();

      expect(refusal.status).toBe(422);
      expect(refusal.isRepairable).toBe(true);
      expect(refusal.details?.currentParticipantSlug).toBe('sentient-glaze');
      expect(new CombatIntentRefusedError('boom', 500).isRepairable).toBe(false);
    });
  });
});

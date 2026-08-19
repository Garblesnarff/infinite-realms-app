/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { askPlayerForAttackDie, isPlayerActor } from '../player-attack-roll';

import { proposeAuthoritativeAttack } from '@/services/combat/combat-attack-proposal';
import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';

/**
 * Whose die it is, and what happens on every path where the player does not throw it.
 *
 * The fallback cases are the ones that matter. Each of them ends at "the engine rolls", which
 * is precisely `main`'s behaviour, so none of them can be a regression — and together they are
 * what guarantees the turn always resolves.
 */

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeAttack: vi.fn(),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
}));

const ATTACK: any = {
  actor_id: 'seeker-id',
  action_type: 'attack',
  target_ids: ['glaze-id'],
  weapon_id: null,
};

const PARTICIPANTS = [
  { id: 'seeker-id', name: 'The Seeker', participantType: 'player' },
  { id: 'glaze-id', name: 'Sentient Glaze', participantType: 'enemy' },
];

const LEGAL_PROPOSAL = {
  movementOnly: false,
  legal: true,
  weaponName: 'claws',
  attackBonus: 7,
  targetAc: 15,
  advantage: true,
  disadvantage: false,
  targetLabel: 'Sentient Glaze',
};

const ask = (): Promise<any> =>
  askPlayerForAttackDie({ encounterId: 'enc-1', action: ATTACK, actorLabel: 'The Seeker' });

describe('the player attack die', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('whose die it is', () => {
    it('belongs to the player only for a player-owned participant', () => {
      expect(isPlayerActor('seeker-id', PARTICIPANTS)).toBe(true);
      expect(isPlayerActor('glaze-id', PARTICIPANTS)).toBe(false);
      expect(isPlayerActor('unknown-id', PARTICIPANTS)).toBe(false);
      // A missing roster cannot claim a die for the player; the DM rolls behind the screen.
      expect(isPlayerActor('seeker-id', undefined)).toBe(false);
    });
  });

  describe('asking for the die', () => {
    it('names a substituted weapon in the popup before the die is thrown', async () => {
      vi.mocked(proposeAuthoritativeAttack).mockResolvedValue({
        ...LEGAL_PROPOSAL,
        weaponName: 'Rapier',
        requestedWeapon: 'punch',
        weaponSubstituted: true,
      } as any);
      vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 16 });

      await ask();
      expect(vi.mocked(requestPlayerAttackRoll).mock.calls[0][0].weaponName).toBe(
        'Rapier (not the declared punch)',
      );
    });

    it('shows the popup the engine’s own numbers, then returns the die', async () => {
      vi.mocked(proposeAuthoritativeAttack).mockResolvedValue(LEGAL_PROPOSAL as any);
      vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 18 });

      await expect(ask()).resolves.toEqual({ d20: 18, autoRolled: false, movementOnly: false });
      // The bonus, AC, and advantage the resolution will apply — not a client approximation.
      expect(vi.mocked(requestPlayerAttackRoll).mock.calls[0][0]).toMatchObject({
        attackBonus: 7,
        targetAc: 15,
        advantage: true,
        weaponName: 'claws',
        targetLabel: 'Sentient Glaze',
      });
    });

    it('falls back to the engine when the player cancels', async () => {
      vi.mocked(proposeAuthoritativeAttack).mockResolvedValue(LEGAL_PROPOSAL as any);
      vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: null });

      await expect(ask()).resolves.toEqual({ autoRolled: true, movementOnly: false });
    });

    it('falls back to the engine when the proposal itself fails', async () => {
      // A dead proposal endpoint must never cost the player their turn.
      vi.mocked(proposeAuthoritativeAttack).mockRejectedValue(new Error('gateway down'));

      await expect(ask()).resolves.toEqual({ autoRolled: true, movementOnly: false });
      expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    });

    it('falls back to the engine when the rules refuse the attack', async () => {
      vi.mocked(proposeAuthoritativeAttack).mockResolvedValue({
        movementOnly: false,
        legal: false,
        refusal: 'out of range',
      } as any);

      await expect(ask()).resolves.toEqual({ autoRolled: true, movementOnly: false });
      // There is nothing to roll for; opening a popup would ask for a die that cannot matter.
      expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    });

    it('opens no popup when the attack resolved as movement instead', async () => {
      vi.mocked(proposeAuthoritativeAttack).mockResolvedValue({ movementOnly: true } as any);

      await expect(ask()).resolves.toEqual({ autoRolled: false, movementOnly: true });
      expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    });

    it('asks nobody when the action names no target', async () => {
      await expect(
        askPlayerForAttackDie({
          encounterId: 'enc-1',
          action: { ...ATTACK, target_ids: [] },
          actorLabel: 'The Seeker',
        }),
      ).resolves.toEqual({ autoRolled: true, movementOnly: false });
      expect(proposeAuthoritativeAttack).not.toHaveBeenCalled();
    });
  });
});

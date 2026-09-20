import { beforeEach, describe, expect, it, vi } from 'vitest';

import { askPlayerForSpellCast } from '../player-spell-cast';

import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';
import { requestSpellTargetSave } from '@/services/combat/spell-target-save-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
}));
vi.mock('@/services/combat/spell-target-save-bridge', () => ({
  requestSpellTargetSave: vi.fn(),
}));

const action = (spellId: string) => ({
  actor_id: 'rook-id',
  action_type: 'cast_spell' as const,
  target_ids: ['professor-id'],
  weapon_id: null,
  spell_id: spellId,
  slot_level: null,
  movement_feet: 0,
});

const PARTICIPANTS = [
  { id: 'rook-id', name: 'Rook' },
  { id: 'professor-id', name: 'Professor Umeboshi' },
];

const ask = (spellId: string) =>
  askPlayerForSpellCast({
    action: action(spellId),
    actorLabel: 'Rook',
    participants: PARTICIPANTS,
  });

describe('askPlayerForSpellCast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 17 });
    vi.mocked(requestSpellTargetSave).mockResolvedValue(undefined);
  });

  it('opens a spell-attack roll popup for Fire Bolt', async () => {
    await expect(ask('fire-bolt')).resolves.toEqual({
      d20: 17,
      autoRolled: false,
      movementOnly: false,
    });
    expect(requestPlayerAttackRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spell-attack',
        weaponName: 'Fire Bolt',
        targetLabel: 'Professor Umeboshi',
      }),
    );
    expect(requestSpellTargetSave).not.toHaveBeenCalled();
  });

  it('opens a target-saves card for Acid Splash and does not ask for a player die', async () => {
    await expect(ask('acid-splash')).resolves.toEqual({ autoRolled: true, movementOnly: false });
    expect(requestSpellTargetSave).toHaveBeenCalledWith({
      actorLabel: 'Rook',
      targetLabel: 'Professor Umeboshi',
      spellName: 'Acid Splash',
      saveAbility: 'DEX',
    });
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
  });

  it('opens no popup for Magic Missile', async () => {
    await expect(ask('magic-missile')).resolves.toEqual({ autoRolled: true, movementOnly: false });
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(requestSpellTargetSave).not.toHaveBeenCalled();
  });

  it('opens no popup for an unknown spell', async () => {
    await expect(ask('meteor-swarm')).resolves.toEqual({ autoRolled: true, movementOnly: false });
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(requestSpellTargetSave).not.toHaveBeenCalled();
  });
});

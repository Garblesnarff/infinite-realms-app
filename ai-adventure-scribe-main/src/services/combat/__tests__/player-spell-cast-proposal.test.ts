/**
 * #2233: the spell popup reads its spell and bonus from the engine's proposal. Run M4 showed a
 * +5 wizard "Fire Bolt spell attack … 1d20+0" for a declared Chill Touch; the popup had no
 * source for either number but a literal 0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { askPlayerForSpellCast } from '../player-spell-cast';

import { describeAttackRoll, attackModifierForRoll } from '@/hooks/combat/use-player-roll-host';
import logger from '@/lib/logger';
import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';
import { proposeAuthoritativeSpell } from '@/services/combat/combat-attack-proposal';
import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
}));
vi.mock('@/services/combat/spell-target-save-bridge', () => ({
  requestSpellTargetSave: vi.fn(),
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn(),
}));

const castChillTouch = (spellId = 'chill_touch') =>
  askPlayerForSpellCast({
    encounterId: 'encounter-m4',
    action: {
      actor_id: 'the-apprentice',
      action_type: 'cast_spell',
      target_ids: ['flavor-elemental-corrupted'],
      weapon_id: null,
      spell_id: spellId,
      slot_level: null,
      movement_feet: 0,
    },
    actorLabel: 'The Apprentice',
    participants: [
      { id: 'the-apprentice', name: 'The Apprentice' },
      { id: 'flavor-elemental-corrupted', name: 'Flavor-Elemental (Corrupted)' },
    ],
  });

describe('askPlayerForSpellCast with an engine proposal (#2233)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 12 });
  });

  it('opens "Chill Touch spell attack … 1d20+5" from the proposal', async () => {
    vi.mocked(proposeAuthoritativeSpell).mockResolvedValue({
      movementOnly: false,
      spellId: 'chill-touch',
      spellName: 'Chill Touch',
      kind: 'attack',
      attackBonus: 5,
      saveDC: 13,
      targetAc: 14,
      advantage: false,
      disadvantage: false,
    });

    await expect(castChillTouch()).resolves.toEqual({
      d20: 12,
      autoRolled: false,
      movementOnly: false,
    });
    expect(proposeAuthoritativeSpell).toHaveBeenCalledWith('encounter-m4', {
      type: 'spell',
      actorId: 'the-apprentice',
      targetIds: ['flavor-elemental-corrupted'],
      spellId: 'chill_touch',
      spellName: 'Chill Touch',
    });
    const spec = vi.mocked(requestPlayerAttackRoll).mock.calls[0][0];
    expect(spec).toMatchObject({ kind: 'spell-attack', weaponName: 'Chill Touch', attackBonus: 5 });
    expect(describeAttackRoll(spec)).toBe(
      'Chill Touch spell attack vs Flavor-Elemental (Corrupted)',
    );
    expect(attackModifierForRoll(spec)).toBe(5);
  });

  it('opens no dialog for a spell the engine refuses; the commit reports the refusal', async () => {
    vi.mocked(proposeAuthoritativeSpell).mockRejectedValue(
      new CombatIntentRefusedError(
        "Spell refused: Fire Bolt is not on The Apprentice's sheet — cast a spell you know or have prepared",
        422,
      ),
    );

    await expect(castChillTouch('fire-bolt')).resolves.toEqual({
      autoRolled: true,
      movementOnly: false,
    });
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
  });

  it('logs one warn with actor id, spell id and reason when the engine refuses the proposal (#2426)', async () => {
    const reason = "Spell refused: Fire Bolt is not on The Apprentice's sheet";
    vi.mocked(proposeAuthoritativeSpell).mockRejectedValue(
      new CombatIntentRefusedError(reason, 422),
    );

    await castChillTouch('fire-bolt');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[SpellAttack] proposal refused or failed; the engine resolves the cast',
      { actorId: 'the-apprentice', spellId: 'fire-bolt', reason },
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs one warn with actor id, spell id and reason when the proposal call throws (#2426)', async () => {
    vi.mocked(proposeAuthoritativeSpell).mockRejectedValue(new Error('network down'));

    await expect(castChillTouch()).resolves.toEqual({ autoRolled: true, movementOnly: false });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[SpellAttack] proposal refused or failed; the engine resolves the cast',
      { actorId: 'the-apprentice', spellId: 'chill_touch', reason: 'network down' },
    );
  });

  it('strips URLs and caps the reason length for a plain Error (#2442)', async () => {
    vi.mocked(proposeAuthoritativeSpell).mockRejectedValue(
      new Error(
        `Failed to fetch https://api.example.test/v1/combat/enc-1/intent?token=abc: ${'{"body":"x"}'.repeat(40)}`,
      ),
    );

    await castChillTouch();

    const [, fields] = vi.mocked(logger.warn).mock.calls[0] as [string, { reason: string }];
    expect(fields.reason).not.toContain('http');
    expect(fields.reason).not.toContain('token=abc');
    expect(fields.reason.startsWith('Failed to fetch [url]')).toBe(true);
    expect(fields.reason).not.toContain('{');
    expect(fields.reason.length).toBeLessThanOrEqual(120);
  });
});

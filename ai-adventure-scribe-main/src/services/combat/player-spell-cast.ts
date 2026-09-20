import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';

import logger from '@/lib/logger';
import { resolvePlayerCombatSpell } from '@/services/combat/player-combat-spell';
import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';
import { requestSpellTargetSave } from '@/services/combat/spell-target-save-bridge';

export interface PlayerSpellCastParams {
  action: StructuredCombatAction;
  actorLabel: string;
  participants?: Array<{ id: string; name?: string }>;
}

export interface PlayerSpellCastResult {
  d20?: number;
  autoRolled: boolean;
  movementOnly: boolean;
}

const labelFor = (
  id: string,
  participants: Array<{ id: string; name?: string }> | undefined,
): string => participants?.find((participant) => participant.id === id)?.name ?? id;

/**
 * Opens the player-facing spell UI, then lets the engine resolve.
 *
 * Attack-roll cantrips get the same dice popup as a weapon. Save spells get a "target
 * saves" card with no player die. Magic Missile and unknown spells skip both — the
 * engine line (or refusal) is the result. The popup never invents a hit, save, or wound.
 */
export async function askPlayerForSpellCast(
  params: PlayerSpellCastParams,
): Promise<PlayerSpellCastResult> {
  const { action, actorLabel, participants } = params;
  const spell = resolvePlayerCombatSpell(action.spell_id, action.spell_id);
  const targetId = action.target_ids[0];
  const targetLabel = targetId ? labelFor(targetId, participants) : 'the target';

  if (!spell || spell.kind === 'auto-hit') {
    return { autoRolled: true, movementOnly: false };
  }

  if (spell.kind === 'save') {
    try {
      await requestSpellTargetSave({
        actorLabel,
        targetLabel,
        spellName: spell.name,
        saveAbility: spell.saveAbility ?? 'DEX',
      });
    } catch (error) {
      logger.warn('[SpellSave] target-save card failed; submitting the spell anyway', error);
    }
    return { autoRolled: true, movementOnly: false };
  }

  try {
    const outcome = await requestPlayerAttackRoll({
      kind: 'spell-attack',
      actorLabel,
      targetLabel,
      weaponName: spell.name,
      attackBonus: 0,
      targetAc: 0,
      advantage: false,
      disadvantage: false,
    });
    if (outcome.d20 === null) return { autoRolled: true, movementOnly: false };
    return { d20: outcome.d20, autoRolled: false, movementOnly: false };
  } catch (error) {
    logger.warn('[SpellAttack] popup failed; the engine rolls this spell', error);
    return { autoRolled: true, movementOnly: false };
  }
}

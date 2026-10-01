import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';

import logger from '@/lib/logger';
import { proposeAuthoritativeSpell } from '@/services/combat/combat-attack-proposal';
import { resolvePlayerCombatSpell } from '@/services/combat/player-combat-spell';
import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';
import { consumeHeldSaveCard } from '@/services/combat/sheet-cast-save-hold';
import { requestSpellTargetSave } from '@/services/combat/spell-target-save-bridge';

export interface PlayerSpellCastParams {
  /** When present, the popup's spell, bonus, and AC come from the engine's proposal (#2233). */
  encounterId?: string;
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
  const { encounterId, action, actorLabel, participants } = params;
  const spell = resolvePlayerCombatSpell(action.spell_id, action.spell_id);
  const targetId = action.target_ids[0];
  let targetLabel = targetId ? labelFor(targetId, participants) : 'the target';

  if (!spell || spell.kind === 'auto-hit') {
    return { autoRolled: true, movementOnly: false };
  }

  if (spell.kind === 'save') {
    // The sheet's Cast already showed this card before the DM was called (#2392).
    if (!consumeHeldSaveCard(spell.name, targetLabel)) {
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
    }
    return { autoRolled: true, movementOnly: false };
  }

  // The engine names the spell and its numbers. Without a proposal the popup would have to
  // guess them, and a guessed "+0" is how #2233 showed a +5 caster the wrong roll; a refused or
  // failed proposal therefore opens no popup and lets the commit resolve or refuse by itself.
  let rollSpec = {
    weaponName: spell.name,
    attackBonus: 0,
    targetAc: 0,
    advantage: false,
    disadvantage: false,
  };
  if (encounterId && !targetId) {
    // No creature to propose against: any popup would show the guessed +0 / AC 0 described above.
    return { autoRolled: true, movementOnly: false };
  }
  if (encounterId && targetId) {
    try {
      const proposal = await proposeAuthoritativeSpell(encounterId, {
        type: 'spell',
        actorId: action.actor_id,
        targetIds: action.target_ids,
        ...(action.spell_id ? { spellId: action.spell_id } : {}),
        spellName: spell.name,
        ...(typeof action.slot_level === 'number' && action.slot_level >= 1
          ? { slotLevel: action.slot_level }
          : {}),
      });
      // The engine names the target it resolved; the DM's ref may be a catalog key such as
      // `srd:vitruvian-spider` that no participant label matches (#2303).
      if (proposal.targetLabel) targetLabel = proposal.targetLabel;
      rollSpec = {
        weaponName: proposal.spellName,
        attackBonus: proposal.attackBonus,
        targetAc: proposal.targetAc,
        advantage: proposal.advantage,
        disadvantage: proposal.disadvantage,
      };
    } catch (error) {
      // A silent engine roll here would look like a popup that never opened, so say why (no
      // player text: ids and the refusal reason only).
      logger.warn('[SpellAttack] proposal refused or failed; the engine resolves the cast', {
        actorId: action.actor_id,
        spellId: action.spell_id,
        reason: error instanceof Error ? error.message : String(error),
      });
      return { autoRolled: true, movementOnly: false };
    }
  }

  try {
    const outcome = await requestPlayerAttackRoll({
      kind: 'spell-attack',
      actorLabel,
      targetLabel,
      ...rollSpec,
    });
    if (outcome.d20 === null) return { autoRolled: true, movementOnly: false };
    return { d20: outcome.d20, autoRolled: false, movementOnly: false };
  } catch (error) {
    logger.warn('[SpellAttack] popup failed; the engine rolls this spell', error);
    return { autoRolled: true, movementOnly: false };
  }
}

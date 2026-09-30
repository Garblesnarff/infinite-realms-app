import type { CombatActionOrigin } from '@/services/combat/combat-action-origin';

import logger from '@/lib/logger';
import { resolvePlayerCombatSpell } from '@/services/combat/player-combat-spell';
import { requestSpellTargetSave } from '@/services/combat/spell-target-save-bridge';

interface HoldParticipant {
  id: string;
  name?: string;
  participantType?: string;
  isDead?: boolean;
  isUnconscious?: boolean;
  currentHitPoints?: number;
}

/**
 * The engine calls every non-player combatant hostile (`isHostile` in `combat-intent-service.ts`)
 * and the client mapping keeps no faction, so "hostile" is "not a player and still standing".
 */
export const standingHostiles = <P extends HoldParticipant>(participants: readonly P[]): P[] =>
  participants.filter(
    (participant) =>
      participant.participantType !== 'player' &&
      !participant.isDead &&
      !participant.isUnconscious &&
      (participant.currentHitPoints ?? 1) > 0,
  );

let held: { spellName: string; targetLabel: string } | null = null;

/** Forget a card shown for an earlier turn. Every turn starts here, so a stale one never skips a card. */
export function clearHeldSaveCard(): void {
  held = null;
}

/** True once, when this turn already showed the card for this spell and creature. */
export function consumeHeldSaveCard(spellName: string, targetLabel: string): boolean {
  const matches = held?.spellName === spellName && held.targetLabel === targetLabel;
  held = null;
  return matches;
}

/**
 * #2392: the sheet's Cast of a save spell shows its "Target saves" card before the DM is called.
 * The card needs no model output: the spell is the one the player pressed, and the creature is the
 * only one standing. Until now the DM's whole reply came first (about 45 s in run 16), because the
 * cast only reached the engine, and so the card, as the DM's declared action.
 *
 * Nothing is held when there is more than one creature to choose from, when it is not the
 * player's turn, or when the spell is not a single-target save spell (Burning Hands is a cone):
 * those turns go to the DM as before.
 */
export async function holdSaveCardBeforeDm(params: {
  origin: CombatActionOrigin | null;
  spellId: string | undefined;
  activeEncounter: {
    currentTurnParticipantId?: string | null;
    participants?: readonly HoldParticipant[];
  } | null;
}): Promise<void> {
  clearHeldSaveCard();
  const { origin, spellId, activeEncounter } = params;
  const participants = activeEncounter?.participants ?? [];
  const caster = participants.find(
    (participant) => participant.id === activeEncounter?.currentTurnParticipantId,
  );
  const spell = resolvePlayerCombatSpell(spellId, spellId);
  const targets = standingHostiles(participants);
  if (
    origin !== 'sheet_cast' ||
    caster?.participantType !== 'player' ||
    spell?.kind !== 'save' ||
    !spell.singleTarget ||
    targets.length !== 1
  ) {
    return;
  }

  // The label askPlayerForSpellCast gives the same creature, so the declared cast can tell the
  // card was already shown. The card renders the display name (#2343 B4).
  const targetLabel = targets[0].name ?? targets[0].id;
  try {
    await requestSpellTargetSave({
      actorLabel: caster.name ?? 'You',
      targetLabel,
      spellName: spell.name,
      saveAbility: spell.saveAbility ?? 'DEX',
    });
  } catch (error) {
    logger.warn('[SpellSave] target-save card failed; the DM turn continues', error);
    return;
  }
  held = { spellName: spell.name, targetLabel };
}

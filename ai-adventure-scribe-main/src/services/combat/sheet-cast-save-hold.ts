import type { CombatActionOrigin } from '@/services/combat/combat-action-origin';

import logger from '@/lib/logger';
import { proposeAuthoritativeSpell } from '@/services/combat/combat-attack-proposal';
import { resolvePlayerCombatSpell } from '@/services/combat/player-combat-spell';
import { askTargetSave } from '@/services/combat/sheet-cast-progress';

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

/**
 * The caster's save DC for the card's "Save DC 14" line, from the engine's own read-only proposal
 * (it claims no action and spends no slot). The card is only a hint, so a refusal or a failed
 * call leaves the DC off; the engine still resolves the cast, or refuses it, as before. Only the
 * sheet's Cast asks: a save spell the DM declares shows its card with no DC, as before.
 */
const DC_PROPOSAL_TIMEOUT_MS = 2000;

async function proposedSaveDc(
  encounterId: string | undefined,
  intent: {
    actorId: string;
    targetId: string;
    spellId: string;
    spellName: string;
    slotLevel?: number;
  },
): Promise<number | undefined> {
  if (!encounterId) return undefined;
  try {
    // A hint must not hold the card: past this the card shows without the DC.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('DC proposal timed out')), DC_PROPOSAL_TIMEOUT_MS);
    });
    const proposal = await Promise.race([
      proposeAuthoritativeSpell(encounterId, {
        type: 'spell',
        actorId: intent.actorId,
        targetIds: [intent.targetId],
        spellId: intent.spellId,
        spellName: intent.spellName,
        ...(intent.slotLevel ? { slotLevel: intent.slotLevel } : {}),
      }),
      timeout,
    ]).finally(() => clearTimeout(timer));
    return Number.isFinite(proposal.saveDC) ? proposal.saveDC : undefined;
  } catch (error) {
    logger.info('[SpellSave] no DC for the card; the engine proposal was refused or failed', error);
    return undefined;
  }
}

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
    id?: string;
    currentTurnParticipantId?: string | null;
    participants?: readonly HoldParticipant[];
  } | null;
}): Promise<'cancelled' | void> {
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
  const saveDc = await proposedSaveDc(activeEncounter?.id, {
    actorId: caster.id,
    targetId: targets[0].id,
    spellId: spell.id,
    spellName: spell.name,
  });
  try {
    const answer = await askTargetSave(
      {
        actorLabel: caster.name ?? 'You',
        targetLabel,
        spellName: spell.name,
        saveAbility: spell.saveAbility ?? 'DEX',
        ...(saveDc !== undefined ? { saveDc } : {}),
      },
      true,
    );
    // Nothing was sent to the DM and the engine has spent nothing: the turn ends here.
    if (answer === 'cancel') return 'cancelled';
  } catch (error) {
    logger.warn('[SpellSave] target-save card failed; the DM turn continues', error);
    return;
  }
  held = { spellName: spell.name, targetLabel };
}

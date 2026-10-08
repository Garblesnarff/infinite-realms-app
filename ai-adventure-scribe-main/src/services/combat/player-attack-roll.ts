import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';

import logger from '@/lib/logger';
import { proposeAuthoritativeAttack } from '@/services/combat/combat-attack-proposal';
import {
  requestPlayerAttackRoll,
  requestPlayerDeathSaveRoll,
} from '@/services/combat/player-roll-bridge';
import { slugify } from '@/utils/slug';

/**
 * The player rolls their own attack die.
 *
 * Every d20 in this engine used to be `Math.floor(Math.random() * 20) + 1` on a server the
 * player never sees. For a monster that is right — the DM rolls behind the screen. For the
 * player's own character it is the one roll at a table that nobody else is allowed to make, and
 * handing it to the server quietly deleted the moment the whole game is built around.
 *
 * The die alone is not enough. A d20 means nothing without the bonus added to it, the AC it has
 * to beat, and whether the rules grant advantage — and all three are engine facts the client
 * cannot compute: cover, the target's dodge, conditions on both sides. So the attack is first
 * *proposed*, which is the engine answering those three questions without claiming the turn or
 * touching hit points, and only then does the popup open with real numbers on it.
 *
 * The engine still owns everything except the die. It adds the bonus, compares to AC, decides
 * criticals, and rolls damage. What changed is who rolls the one die that decides whether the
 * blow lands.
 */

/** A player-owned participant is the only actor whose die is theirs to roll. */
export function isPlayerActor(
  actorId: string,
  participants: Array<{ id: string; name?: string; participantType?: string }> | undefined,
): boolean {
  return (
    participants?.some(
      (participant) =>
        participant.participantType === 'player' &&
        (participant.id === actorId || slugify(participant.name ?? '') === actorId),
    ) ?? false
  );
}

export interface PlayerAttackDieParams {
  encounterId: string;
  action: StructuredCombatAction;
  actorLabel: string;
}

/**
 * Proposes the attack, asks the player for the die, and reports what came back.
 *
 * Returns `{ d20: undefined, autoRolled: true }` for every case where no player die was
 * produced: a proposal the engine refused on legality, an attack that resolved as movement
 * because the target was out of reach, a cancelled or abandoned popup, or any failure of the
 * proposal itself.
 *
 * `autoRolled` is reported rather than left implicit so callers can decide. The action-bar
 * caller (`DynamicOptionsSection`) treats it as a stop: the chip shows a menu alert and spends
 * nothing, because committing an undefined die would let the engine roll for the player —
 * the bug #2652 exists to close. Other callers (typed attacks, the DM pipeline) keep the old
 * deliberate-and-total fallback: the turn must always be resolvable, because a combat that
 * can wedge behind a modal is worse than a die the player did not personally throw. The
 * transcript still says the engine rolled, so a player who closed the popup never wonders
 * whether dice are being hidden.
 */
export async function askPlayerForAttackDie(
  params: PlayerAttackDieParams,
): Promise<{ d20?: number; autoRolled: boolean; movementOnly: boolean }> {
  const { encounterId, action, actorLabel } = params;
  const targetId = action.target_ids[0];
  if (!targetId) return { autoRolled: true, movementOnly: false };
  try {
    const proposal = await proposeAuthoritativeAttack(encounterId, {
      type: 'attack',
      actorId: action.actor_id,
      targetId,
      weaponId: action.weapon_id || undefined,
    });
    if (proposal.movementOnly) {
      // The attacker could not reach; the approach already moved it and there is no attack to
      // roll for. The commit below resolves the same movement rather than opening a popup.
      return { autoRolled: false, movementOnly: true };
    }
    if (proposal.legal === false) {
      logger.info(`[PlayerRoll] proposal illegal (${proposal.refusal}); engine resolves`);
      return { autoRolled: true, movementOnly: false };
    }
    const resolvedWeapon = proposal.weaponName ?? 'attack';
    const weaponName =
      proposal.weaponSubstituted && proposal.requestedWeapon
        ? `${resolvedWeapon} (not the declared ${proposal.requestedWeapon})`
        : resolvedWeapon;
    if (proposal.weaponSubstituted) {
      logger.info('[PlayerRoll] weapon substitution surfaced before the die', {
        requested: proposal.requestedWeapon,
        resolved: resolvedWeapon,
      });
    }
    const outcome = await requestPlayerAttackRoll({
      actorLabel,
      targetLabel: proposal.targetLabel ?? targetId,
      weaponName,
      attackBonus: proposal.attackBonus ?? 0,
      targetAc: proposal.targetAc ?? 10,
      advantage: !!proposal.advantage,
      disadvantage: !!proposal.disadvantage,
    });
    if (outcome.d20 === null) return { autoRolled: true, movementOnly: false };
    return { d20: outcome.d20, autoRolled: false, movementOnly: false };
  } catch (error) {
    // A failed proposal must not cost the player their turn. The engine rolls it as it always
    // did, which is exactly the behaviour on `main`, so this path can never be a regression.
    logger.warn('[PlayerRoll] proposal failed; the engine rolls this attack', error);
    return { autoRolled: true, movementOnly: false };
  }
}

/**
 * The dying player's death saving throw die. There is nothing to propose first: the roll is a
 * bare d20 against DC 10, with no bonus, no target and no advantage, so the prompt opens at once.
 *
 * Returns `{ d20: undefined, autoRolled: true }` when the prompt timed out or was dismissed. A
 * dying character cannot decline their own turn, so the engine rolls the die rather than the
 * action being withdrawn, and the transcript says so, as it does for every other player die.
 */
export async function askPlayerForDeathSaveDie(params: {
  actorLabel: string;
}): Promise<{ d20?: number; autoRolled: boolean }> {
  try {
    const outcome = await requestPlayerDeathSaveRoll({ actorLabel: params.actorLabel });
    if (outcome.d20 === null) return { autoRolled: true };
    return { d20: outcome.d20, autoRolled: false };
  } catch (error) {
    logger.warn('[PlayerRoll] death save prompt failed; the engine rolls it', error);
    return { autoRolled: true };
  }
}

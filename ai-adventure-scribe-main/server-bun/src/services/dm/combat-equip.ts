/**
 * #1059/#1069: a weapon equip declared in a story or combat turn, resolved
 * before the DM narrates.
 *
 * The typed words had no engine path at all: "I draw my shortbow" was pure
 * prose, the DM accepted it, and the next attack still refused 'Shortbow
 * is not equipped' because nothing had written the equip (Hark N23-008).
 * This module gives the typed declaration the same write the in-session
 * Equip control makes (CharacterEquipService): detect the declaration
 * against the weapons the character actually carries, equip it, post the
 * engine line, and return a DM directive carrying the engine's truth —
 * the equip, the already-in-hand fact, or the not-carrying refusal — so
 * the player always hears what happened.
 *
 * Drawing or stowing a weapon is the turn's free object interaction
 * (PHB), so the equip spends neither the action nor the bonus action and
 * the turn stays open; a same-turn attack declared alongside it resolves
 * against the now-equipped weapon.
 *
 * Runs pre-generation, like the declared Second Wind resolution, gated
 * the same way by the caller (dmReply): narration regens carry no dmReply,
 * and resolving there would post the line twice. A failed run is logged
 * and yields no directive; it never costs the player their turn.
 *
 * @module server/services/dm/combat-equip
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { logger } from '../../lib/logger.js';
import { detectDeclaredEquip } from '../combat/combat-intent-gate.js';

/**
 * Detect a typed equip declaration in a story or active combat turn and
 * resolve it. Returns the DM directive carrying the engine's outcome, or
 * null when the input declares nothing or the resolution cannot run at
 * all (fail open: the DM narrates without engine truth and nothing is
 * written).
 */
export async function resolveCombatEquip(input: {
  playerInput: string;
  sessionId: string;
  userId: string;
}): Promise<string | null> {
  const { playerInput, sessionId, userId } = input;

  try {
    const character = await ownedSessionCharacter(sessionId, userId);
    if (!character) return null;

    const { listCarriedWeaponProfiles, listEquippedWeaponProfiles } = await import(
      '../combat/data-access.js'
    );
    const { catalogWeaponNames, normalizeWeaponName } = await import(
      '../combat/weapon-catalog.js'
    );
    const { resolveWeaponName } = await import('../../../../shared/equipment-weapon-resolver');
    const [carried, equipped] = await Promise.all([
      listCarriedWeaponProfiles({ characterId: character.id }),
      listEquippedWeaponProfiles({ characterId: character.id }),
    ]);
    const sameWeapon = (a: string, b: string): boolean =>
      normalizeWeaponName(a) === normalizeWeaponName(b) ||
      (resolveWeaponName(a) !== undefined && resolveWeaponName(a) === resolveWeaponName(b));
    const candidates = [
      ...carried.map((profile) => ({ name: profile.name, carried: true })),
      ...catalogWeaponNames()
        .filter((name) => !carried.some((profile) => sameWeapon(profile.name, name)))
        .map((name) => ({ name, carried: false })),
    ];
    const declared = detectDeclaredEquip(playerInput, candidates, [character.name ?? '']);
    if (!declared) return null;

    const characterName = character.name || 'The character';
    if (!declared.carried) {
      return equipDirective(
        `The engine refused it: ${characterName} is not carrying a ${declared.name}. Narrate the failure clearly. Do NOT narrate them equipping or using a ${declared.name} this turn.`,
      );
    }
    if (equipped.some((profile) => sameWeapon(profile.name, declared.name))) {
      return equipDirective(
        `The engine's truth: the ${declared.name} is already equipped — ${characterName} has it in hand. Narrate accordingly. Do NOT narrate them drawing a weapon they already hold as if it were stowed.`,
      );
    }

    const { CharacterEquipService } = await import('../inventory/character-equip-service.js');
    const result = await CharacterEquipService.equipItem(character.id, userId, declared.name);
    if (!result.success) {
      // The carried list just read this weapon; a miss here means it left
      // the character mid-turn. Fail open rather than hand the DM a truth
      // the sheet does not hold.
      logger.warn({ msg: 'COMBAT_EQUIP_NOT_FOUND', sessionId, weapon: declared.name });
      return null;
    }

    try {
      const { postEngineChatLine } = await import('../engine-chat-line.js');
      const { playerMessage } = await import('./story-spell-slots.js');
      const message = await playerMessage(sessionId);
      await postEngineChatLine({
        sessionId,
        userId,
        // A Retry replays the same saved player message, so the seed is
        // stable across the replay and the line posts once; a genuinely
        // new equip declaration is a new message and posts its own line.
        idSeed: `equip:${sessionId}:${character.id}:${normalizeWeaponName(declared.name)}:${message?.createdAt?.toISOString() ?? 'no-message'}`,
        text: `⚙️ Engine: ${characterName} equips the ${declared.name}.`,
        context: { kind: 'weapon_equip', weaponName: declared.name },
      });
    } catch (lineError) {
      // The equip landed; a lost line must not lose the directive too.
      logger.warn({ msg: 'COMBAT_EQUIP_LINE_FAILED', sessionId, error: lineError });
    }

    return equipDirective(
      `The engine has already resolved it: ${characterName} has equipped the ${declared.name}. Drawing a weapon is the turn's free object interaction, so it costs neither their action nor their bonus action, and the ${declared.name} is now equipped for their attacks. Narrate the draw truthfully as part of the turn.`,
    );
  } catch (error) {
    logger.warn({ msg: 'COMBAT_EQUIP_FAILED', sessionId, error });
    return null;
  }
}

function equipDirective(truth: string): string {
  return `<weapon_equip>The player declared equipping a weapon. ${truth}</weapon_equip>`;
}

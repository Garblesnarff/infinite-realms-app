import type { RollRequest } from '@/types/roll-request';

import { isPlayerActor } from '@/services/combat/player-attack-roll';
import { slugify } from '@/utils/slug';

export interface EncounterParticipantRef {
  id: string;
  name?: string;
  participantType?: string;
}

/**
 * Who rolls the dice.
 *
 * The LLM's `autoExecute` flag is not a routing signal — it is often omitted, and when
 * omitted the previous default handed the die to the player. Issue #1857: that default
 * put a monster's attack in a player-facing popup.
 *
 * A roll is the player's only when the encounter roster proves the actor is player-owned.
 * Attacks that cannot be proven as the player's are rolled behind the screen. Unnamed
 * skill checks and saves stay player-facing: that is how this solo game asks the human
 * to roll, and those requests never name an NPC actor.
 */
export function shouldAutoExecuteRoll(
  request: RollRequest,
  participants: EncounterParticipantRef[] | undefined,
): boolean {
  if (isProvenPlayerRoll(request, participants)) return false;
  if (request.type === 'attack') return true;
  // A named non-player actor (NPC save, NPC damage, etc.) is never the human's die.
  if (request.actorName) return true;
  return Boolean(request.autoExecute);
}

export function isProvenPlayerRoll(
  request: RollRequest,
  participants: EncounterParticipantRef[] | undefined,
): boolean {
  const keys = actorKeysFromRequest(request);
  return keys.some(
    (key) => isPlayerActor(key, participants) || isPlayerActor(slugify(key), participants),
  );
}

function actorKeysFromRequest(request: RollRequest): string[] {
  const keys: string[] = [];
  if (request.actorName?.trim()) keys.push(request.actorName.trim());
  // Verb form only ("X attacks Y"). Noun form ("Mace attack vs Y") is not an actor.
  const fromPurpose = request.purpose?.match(/^(.*?)\s+attacks\b/i)?.[1]?.trim();
  if (fromPurpose) keys.push(fromPurpose);
  return keys;
}

/**
 * `buildAIContext` stores roster entries as `{ type }` rather than `{ participantType }`.
 * `isPlayerActor` reads `participantType`. Accept both so routing does not silently
 * treat every combatant as unknown.
 */
export function encounterParticipantsFromContext(
  aiContext: Record<string, unknown>,
): EncounterParticipantRef[] {
  const gameState = aiContext.gameState as Record<string, unknown> | undefined;
  const raw = (gameState?.participants ??
    (aiContext.activeEncounter as { participants?: unknown } | undefined)?.participants ??
    []) as Array<Record<string, unknown>>;

  if (!Array.isArray(raw)) return [];

  return raw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id ?? ''),
      name: typeof entry.name === 'string' ? entry.name : undefined,
      participantType:
        typeof entry.participantType === 'string'
          ? entry.participantType
          : typeof entry.type === 'string'
            ? entry.type
            : undefined,
    }));
}

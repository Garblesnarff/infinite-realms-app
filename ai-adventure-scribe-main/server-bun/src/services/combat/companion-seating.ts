import type { CreateParticipantInput } from '../../types/combat.js';

/**
 * Add active companion characters to the same participant input stream as the main character.
 * The caller's explicit character input wins if a retry already included that companion; the
 * downstream stat/initiative/HP derivation then treats both inputs identically.
 */
export function appendActiveCompanionInputs(
  participantInputs: CreateParticipantInput[],
  activeCompanions: Array<{ characterId: string; name: string }>,
): CreateParticipantInput[] {
  const alreadySeated = new Set(
    participantInputs.map((input) => input.characterId).filter((id): id is string => Boolean(id)),
  );
  const companionInputs = activeCompanions
    .filter((companion) => !alreadySeated.has(companion.characterId))
    .map((companion) => ({
      encounterId: '',
      characterId: companion.characterId,
      name: companion.name,
      initiativeModifier: 0,
    }));
  return [...participantInputs, ...companionInputs];
}

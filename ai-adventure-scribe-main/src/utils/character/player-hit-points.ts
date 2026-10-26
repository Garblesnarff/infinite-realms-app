import { getCharacterSheetHitPoints } from './character-sheet-hit-points';

import type { Character } from '@/types/character';
import type { CombatEncounter } from '@/types/combat-encounter';

export interface PlayerHitPoints {
  current: number | null;
  maximum: number | null;
  /** Temporary HP: only the encounter carries it; the sheet has no temp field. */
  temp: number;
  source: 'encounter' | 'sheet';
}

/**
 * The ONE hit-point value the TurnBar, the party panel and the sheet read (#85): the
 * encounter participant's HP while an encounter is active, the stored sheet HP otherwise.
 * The party panel already reads this way (mergePartyMembers overlays participant HP in
 * combat); the sheet did not, which is how it showed 7/7 while the panel showed 4/7
 * mid-fight. Nulls mean the value is not known yet: callers show a skeleton, never "—".
 */
export function resolvePlayerHitPoints(
  encounter: CombatEncounter | null,
  character: Character | null,
): PlayerHitPoints {
  const participant = encounter?.participants.find(
    (candidate) => candidate.participantType === 'player' && candidate.isActive !== false,
  );
  if (encounter && participant) {
    return {
      current: participant.currentHitPoints,
      maximum: participant.maxHitPoints,
      temp: participant.temporaryHitPoints ?? 0,
      source: 'encounter',
    };
  }
  const sheet = character
    ? getCharacterSheetHitPoints(character)
    : { current: null, maximum: null };
  return { current: sheet.current, maximum: sheet.maximum, temp: 0, source: 'sheet' };
}

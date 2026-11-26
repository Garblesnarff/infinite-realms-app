import logger from '@/lib/logger';
import { publishDismissedInitiativeRoll } from '@/services/combat/roll-outcome-display';

/** Mirrors the server's seating match in server-bun/src/services/combat/combat-entry-gate.ts buildCombatSeatingTranscript. */
export function seatedPlayerInitiative(
  entryPayload: unknown,
  player: { characterId?: string | null; name?: string | null },
): number | undefined {
  const participants = (entryPayload as { participants?: unknown } | null)?.participants;
  if (!Array.isArray(participants)) return undefined;
  let playerParticipant: unknown;
  if (player.characterId) {
    playerParticipant = participants.find(
      (p) =>
        !!p &&
        typeof p === 'object' &&
        (p as Record<string, unknown>).characterId === player.characterId,
    );
  } else {
    playerParticipant = participants.find(
      (p) =>
        !!p &&
        typeof p === 'object' &&
        (p as Record<string, unknown>).name === (player.name || 'Player'),
    );
  }
  const total =
    playerParticipant && typeof playerParticipant === 'object'
      ? (playerParticipant as Record<string, unknown>).initiative
      : undefined;
  return typeof total === 'number' && Number.isFinite(total) ? total : undefined;
}

export function reportDismissedInitiative(
  initiative: { dismissed?: boolean; rollId?: string },
  entryPayload: unknown,
  player: { characterId?: string | null; name?: string | null },
): void {
  if (initiative.dismissed !== true || !initiative.rollId) return;
  const total = seatedPlayerInitiative(entryPayload, player);
  if (total !== undefined) {
    publishDismissedInitiativeRoll(initiative.rollId, total);
  } else {
    logger.warn('[CombatEntry] dismissed initiative but no player participant/number found', {
      rollId: initiative.rollId,
    });
  }
}

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

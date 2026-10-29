import { fetchWithAuth } from '@/infrastructure/api/rest-client';

interface TacticalEntityLike {
  id: string;
  movementRemaining?: number | null;
}

interface TacticalMapLike {
  entities?: TacticalEntityLike[];
}

/**
 * Movement the actor still has on the tactical board, or `null` when the board cannot say
 * (no session, no active map, fetch failed, entity absent).
 *
 * `null` means "unknown": callers keep the pre-#263 behavior rather than stranding a turn
 * open on a failed fetch. A resolved attack ends the player's turn only when they have
 * nothing left to do, and a level 1 Fighter who just swung still has movement (#263 CB-011).
 */
export async function actorMovementRemaining(
  sessionId: string | undefined,
  actorId: string,
): Promise<number | null> {
  if (!sessionId) return null;
  try {
    const response = await fetchWithAuth(
      `/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map`,
    );
    if (!response.ok) return null;
    // #1185: the route returns the active map itself; only the no-map read is `{ map: null }`.
    // Reading `.map` alone made every active map look unknown, so every cast ended the turn.
    const payload: unknown = await response.json();
    const map: TacticalMapLike | null =
      payload && typeof payload === 'object'
        ? 'map' in payload
          ? ((payload as { map?: TacticalMapLike | null }).map ?? null)
          : (payload as TacticalMapLike)
        : null;
    const entity = map?.entities?.find((candidate) => candidate.id === actorId);
    return typeof entity?.movementRemaining === 'number' ? entity.movementRemaining : null;
  } catch {
    return null;
  }
}

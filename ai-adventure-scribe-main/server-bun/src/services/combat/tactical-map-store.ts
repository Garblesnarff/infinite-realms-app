// Use the app workspace's Drizzle instance: db/schema intentionally live outside server-bun.
import { db } from '../../../../db/client.js';
import { tacticalMaps } from '../../../../db/schema/index.js';
import { and, desc, eq } from '../../../../node_modules/drizzle-orm/index.js';
import { assignEntitySlugs } from '../../tactical/identity.js';

import type { TacticalMap } from '../../tactical/types.js';

export async function loadActiveTacticalMap(sessionId: string): Promise<TacticalMap | null> {
  const [row] = await db
    .select()
    .from(tacticalMaps)
    .where(and(eq(tacticalMaps.sessionId, sessionId), eq(tacticalMaps.active, true)))
    .orderBy(desc(tacticalMaps.updatedAt))
    .limit(1);
  if (!row) return null;
  const map = row.state as TacticalMap;
  // Encounters that started before slugs existed are backfilled in place, so a live session
  // stops showing the DM raw UUIDs the moment this deploys. The next save persists them.
  assignEntitySlugs(map.entities);
  return map;
}

/**
 * The session's most recent tactical map row, ACTIVE OR NOT, with the row id needed to write
 * back to that exact row.
 *
 * This exists for one reason, and it is the reason no fight ending has ever been narrated.
 * Engine-resolved facts — the killing blow above all — are written onto the map by
 * `recordDmTacticalFact`, and `endCombatIfResolved` then calls `destroyTacticalCombatMap`,
 * which flips `active` to false. `loadActiveTacticalMap` returns null for a deactivated map,
 * so the very next context fetch found nothing to consume and the fact was gone. The fatal
 * blow was structurally the one blow that could never be reported, in both directions: the
 * player felling the last hostile and the player going down.
 *
 * The row itself is never deleted, only deactivated, so it is a perfectly good place to leave
 * a message for the DM — the lookup was simply asking the wrong question. Asking for "the
 * latest row for this session" instead of "the active row" makes the fact channel
 * session-scoped, which is what it always was conceptually, with no new table and therefore no
 * migration to apply by hand on a production VPS before combat narration works again.
 */
export async function loadLatestTacticalMapRow(
  sessionId: string,
): Promise<{ rowId: string; state: TacticalMap; active: boolean } | null> {
  const [row] = await db
    .select()
    .from(tacticalMaps)
    .where(eq(tacticalMaps.sessionId, sessionId))
    .orderBy(desc(tacticalMaps.updatedAt))
    .limit(1);
  if (!row) return null;
  const state = row.state as TacticalMap;
  assignEntitySlugs(state.entities);
  return { rowId: row.id, state, active: row.active };
}

/**
 * Writes state back to one specific row by id.
 *
 * Deliberately not `saveTacticalMap`: that one targets the ACTIVE row and inserts a new active
 * row when there is none, so using it to leave a note on a torn-down map would resurrect the
 * board for a fight that has finished.
 */
export async function saveTacticalMapRow(rowId: string, state: TacticalMap): Promise<void> {
  await db
    .update(tacticalMaps)
    .set({ state, updatedAt: new Date() })
    .where(eq(tacticalMaps.id, rowId));
}

export async function saveTacticalMap(map: TacticalMap): Promise<void> {
  const existing = await loadActiveTacticalMap(map.sessionId);
  if (existing) {
    await db
      .update(tacticalMaps)
      .set({ state: map, updatedAt: new Date() })
      .where(and(eq(tacticalMaps.sessionId, map.sessionId), eq(tacticalMaps.active, true)));
  } else
    await db
      .insert(tacticalMaps)
      .values({ id: map.id, sessionId: map.sessionId, state: map, active: true });
}

export async function deactivateTacticalMap(sessionId: string): Promise<void> {
  await db
    .update(tacticalMaps)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(tacticalMaps.sessionId, sessionId), eq(tacticalMaps.active, true)));
}

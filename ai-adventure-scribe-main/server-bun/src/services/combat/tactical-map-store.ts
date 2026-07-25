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

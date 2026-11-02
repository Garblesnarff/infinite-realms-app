import { randomUUID } from 'node:crypto';

import { and, eq, exists, or, sql } from 'drizzle-orm';

import {
  characters,
  characterEquipment,
  dialogueHistory,
  gameSessions,
  inventoryItems,
} from '../../../../db/schema/index';

import type { db } from '../../../../db/client';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Spent = {
  encounterId: string;
  characterId: string;
  itemId: string;
  itemName: string;
  source: 'equipment' | 'inventory';
  kind: string;
};

export async function recoverAmmunition(
  tx: Tx,
  encounterId: string,
  sessionId: string,
  userId: string,
) {
  const [session] = await tx
    .select({ state: gameSessions.sessionState })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .for('update');
  const state =
    session?.state && typeof session.state === 'object' && !Array.isArray(session.state)
      ? (session.state as Record<string, unknown>)
      : {};
  const entries = Array.isArray(state.ammunition_spent) ? (state.ammunition_spent as Spent[]) : [];
  const spent = entries.filter((entry) => entry?.encounterId === encounterId);
  if (!spent.length) return [];
  const groups = new Map<string, Spent[]>();
  for (const entry of spent) {
    const key = `${entry.characterId}:${entry.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const rows: Array<typeof dialogueHistory.$inferSelect> = [];
  for (const group of groups.values()) {
    let remaining = Math.floor(group.length / 2);
    if (!remaining) continue;
    const counts = new Map<string, { item: Spent; count: number }>();
    for (const item of group) {
      const key = `${item.source}:${item.itemId}`;
      const previous = counts.get(key);
      counts.set(key, { item, count: (previous?.count ?? 0) + 1 });
    }
    let recovered = 0;
    for (const { item, count } of counts.values()) {
      if (!remaining) break;
      const quantity = Math.min(remaining, count);
      const owned = exists(
        tx
          .select({ id: characters.id })
          .from(characters)
          .where(
            and(
              eq(characters.id, item.characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
            ),
          ),
      );
      const updated =
        item.source === 'equipment'
          ? await tx
              .update(characterEquipment)
              .set({
                quantity: sql`${characterEquipment.quantity} + ${quantity}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(characterEquipment.id, item.itemId),
                  eq(characterEquipment.characterId, item.characterId),
                  owned,
                ),
              )
              .returning({ id: characterEquipment.id })
          : await tx
              .update(inventoryItems)
              .set({
                quantity: sql`${inventoryItems.quantity} + ${quantity}`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(inventoryItems.id, item.itemId),
                  eq(inventoryItems.characterId, item.characterId),
                  owned,
                ),
              )
              .returning({ id: inventoryItems.id });
      if (!updated.length) continue;
      remaining -= quantity;
      recovered += quantity;
    }
    if (remaining)
      throw new Error('Cannot recover ammunition: its recorded inventory stack is missing');
    const item = group[0];
    const noun = recovered === 1 ? item.kind.slice(0, -1) : item.kind;
    const line = `Recovered ${recovered} ${noun} after combat.`;
    const [row] = await tx
      .insert(dialogueHistory)
      .values({
        id: randomUUID(),
        sessionId,
        speakerType: 'system',
        message: line,
        context: { intent: 'ammunition_recovery', combatEncounterId: encounterId },
      })
      .returning();
    rows.push(row);
  }
  await tx
    .update(gameSessions)
    .set({
      sessionState: {
        ...state,
        ammunition_spent: entries.filter((entry) => entry?.encounterId !== encounterId),
      },
    })
    .where(eq(gameSessions.id, sessionId));
  return rows;
}

import { ammunitionForWeapon, isAmmunition } from './ammunition.js';
import { BusinessLogicError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/** Spend one round after the engine has accepted a player's ranged attack. */
export async function spendRangedAmmunition(
  characterId: string | null | undefined,
  userId: string,
  weaponName: string,
  sessionId: string,
  encounterId: string,
): Promise<void> {
  const ammoType = ammunitionForWeapon(weaponName);
  if (!ammoType) return;
  if (!characterId)
    throw new BusinessLogicError('Cannot spend ammunition without an owned character', {
      reason: 'no_ammunition',
    });
  const { db } = await import('../../../../db/client');
  const { and, eq, exists, gt, or, sql } = await import('drizzle-orm');
  const { characters, characterEquipment, inventoryItems, gameSessions, combatEncounters } =
    await import('../../../../db/schema');
  await db.transaction(async (tx) => {
    // Serialize the spend against the terminal claim in concludeEncounter.
    const [encounter] = await tx
      .select({ status: combatEncounters.status })
      .from(combatEncounters)
      .where(and(eq(combatEncounters.id, encounterId), eq(combatEncounters.sessionId, sessionId)))
      .for('update');
    if (!encounter || encounter.status !== 'active')
      throw new BusinessLogicError('Combat has ended', { reason: 'encounter_ended' });
    const owned = exists(
      tx
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        ),
    );
    const sheet = (
      await tx
        .select({ id: characterEquipment.id, name: characterEquipment.itemName })
        .from(characterEquipment)
        .where(
          and(
            eq(characterEquipment.characterId, characterId),
            gt(characterEquipment.quantity, 0),
            owned,
          ),
        )
        .orderBy(characterEquipment.createdAt, characterEquipment.id)
    ).find((item) => isAmmunition(item.name, ammoType));
    let spent: { id: string; name: string; source: 'equipment' | 'inventory' } | undefined;
    if (sheet) {
      const [updated] = await tx
        .update(characterEquipment)
        .set({ quantity: sql`${characterEquipment.quantity} - 1`, updatedAt: new Date() })
        .where(
          and(
            eq(characterEquipment.id, sheet.id),
            eq(characterEquipment.characterId, characterId),
            gt(characterEquipment.quantity, 0),
            owned,
          ),
        )
        .returning({ id: characterEquipment.id });
      if (updated) spent = { ...sheet, source: 'equipment' };
    } else {
      const item = (
        await tx
          .select({ id: inventoryItems.id, name: inventoryItems.name })
          .from(inventoryItems)
          .where(
            and(eq(inventoryItems.characterId, characterId), gt(inventoryItems.quantity, 0), owned),
          )
          .orderBy(inventoryItems.createdAt, inventoryItems.id)
      ).find((candidate) => isAmmunition(candidate.name, ammoType));
      if (item) {
        const [updated] = await tx
          .update(inventoryItems)
          .set({ quantity: sql`${inventoryItems.quantity} - 1`, updatedAt: new Date() })
          .where(
            and(
              eq(inventoryItems.id, item.id),
              eq(inventoryItems.characterId, characterId),
              gt(inventoryItems.quantity, 0),
              owned,
            ),
          )
          .returning({ id: inventoryItems.id });
        if (updated) spent = { ...item, source: 'inventory' };
      }
    }
    if (!spent)
      throw new BusinessLogicError(`Cannot use ${weaponName}: no ${ammoType} available`, {
        reason: 'no_ammunition',
        ammunition: ammoType,
      });
    await tx
      .update(gameSessions)
      .set({
        sessionState: sql`jsonb_set(coalesce(${gameSessions.sessionState}, '{}'::jsonb), '{ammunition_spent}',
        coalesce(${gameSessions.sessionState}->'ammunition_spent', '[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('encounterId', ${encounterId}::text, 'characterId', ${characterId}::text,
          'itemId', ${spent.id}::text, 'itemName', ${spent.name}::text, 'source', ${spent.source}::text, 'kind', ${ammoType}::text)), true)`,
      })
      .where(eq(gameSessions.id, sessionId));
  });
  const { deferUntilCommit } = await import('../../../../db/transaction-context');
  const logSpend = () =>
    logger.info({ msg: 'COMBAT_AMMUNITION_SPENT', sessionId, characterId, ammoType });
  if (!deferUntilCommit(logSpend)) logSpend();
}

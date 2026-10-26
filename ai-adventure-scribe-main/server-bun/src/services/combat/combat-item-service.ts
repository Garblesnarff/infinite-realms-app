import { and, eq, or } from 'drizzle-orm';

import { parseHealingDice, type HealingDice } from './combat-healing-dice.js';
import { db } from '../../../../db/client';
import { characters, combatParticipantStatus, inventoryItems } from '../../../../db/schema/index';
import { BusinessLogicError, NotFoundError } from '../../lib/errors.js';
import { rollDie } from '../../lib/rng.js';
import { CombatHPService } from '../combat-hp-service.js';
import { InventoryConsumableService } from '../inventory/inventory-consumable-service.js';

function healingDiceOf(properties: string | null): HealingDice | null {
  if (!properties) return null;
  try {
    const parsed = JSON.parse(properties) as { healingDice?: unknown };
    return parseHealingDice(parsed?.healingDice);
  } catch {
    return null;
  }
}

export interface ResolveUseItemInput {
  characterId: string;
  userId: string;
  participantId: string;
  encounterId: string;
  sessionId: string;
  itemId: string;
}

export interface ResolveUseItemResult {
  applied: boolean;
  action: 'use_item';
  itemName: string;
  itemId: string;
  roll: { dice: number[]; modifier: number; total: number };
  healed: number;
  newHp: number;
  maxHp: number;
  remainingQuantity: number;
  itemDeleted: boolean;
}

export async function resolveUseItem(input: ResolveUseItemInput): Promise<ResolveUseItemResult> {
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.id, input.itemId), eq(inventoryItems.characterId, input.characterId)),
    )
    .limit(1);
  if (!item) {
    throw new NotFoundError('Inventory item', input.itemId);
  }
  // #1147 FIX round: ownership is checked BEFORE any write. healDamage
  // authorizes by campaign/session owner while useConsumable authorizes by
  // character owner, so a campaign-owner non-PC-owner used to pass the heal
  // and then fail the spend — leaving the heal standing and the potion
  // unspent. This check uses useConsumable's exact predicate.
  const [ownerRow] = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.id, input.characterId),
        or(eq(characters.userId, input.userId), eq(characters.ownerId, input.userId)),
      ),
    )
    .limit(1);
  if (!ownerRow) {
    throw new BusinessLogicError('Cannot use an item on a character you do not own');
  }
  if (item.itemType !== 'consumable') {
    throw new BusinessLogicError(`${item.name} is not a consumable`);
  }
  if (item.quantity <= 0) {
    throw new BusinessLogicError(`${item.name} has none left`);
  }
  const healingDice = healingDiceOf(item.properties);
  if (!healingDice) {
    throw new BusinessLogicError(`${item.name} has no healing effect`);
  }
  const [status] = await db
    .select({ currentHp: combatParticipantStatus.currentHp, maxHp: combatParticipantStatus.maxHp })
    .from(combatParticipantStatus)
    .where(eq(combatParticipantStatus.participantId, input.participantId))
    .limit(1);
  if (!status) {
    throw new NotFoundError('Combat participant status', input.participantId);
  }
  // Refused before anything is spent: a potion drunk at full health would burn
  // the item for zero healing, mirroring Second Wind's full-health refusal.
  if (status.currentHp >= status.maxHp) {
    throw new BusinessLogicError('Already at full health', { reason: 'already_full_health' });
  }

  const dice: number[] = [];
  for (let i = 0; i < healingDice.count; i++) {
    dice.push(rollDie(healingDice.sides));
  }
  const total = Math.max(0, dice.reduce((sum, roll) => sum + roll, 0) + healingDice.modifier);
  // Self-review: a drink that would heal nothing spends nothing — the same
  // refuse-before-spending principle as the full-health refusal above. Inside
  // the claim, so the Action refunds.
  if (total <= 0) {
    throw new BusinessLogicError(`${item.name} would restore no health`);
  }
  const healing = await CombatHPService.healDamage(
    input.participantId,
    input.encounterId,
    total,
    'combat-use-item',
    input.userId,
  );
  // A decrement failure after the heal propagates: the claim wrapper refunds the
  // Action, and the heal and the item stand — the failure favors the player.
  // eslint-disable-next-line react-hooks/rules-of-hooks -- server-side class method, not a React hook
  const usage = await InventoryConsumableService.useConsumable(
    {
      characterId: input.characterId,
      itemId: input.itemId,
      quantity: 1,
      sessionId: input.sessionId,
      context: 'combat-use-item',
    },
    input.userId,
  );
  return {
    applied: true,
    action: 'use_item',
    itemName: item.name,
    itemId: item.id,
    roll: { dice, modifier: healingDice.modifier, total },
    healed: healing.healingApplied,
    newHp: healing.newCurrentHp,
    maxHp: status.maxHp,
    remainingQuantity: usage.remainingQuantity,
    itemDeleted: usage.itemDeleted,
  };
}

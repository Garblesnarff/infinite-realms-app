/**
 * Healing-dice expressions on consumable item properties (e.g. "2d4+2").
 *
 * Leaf module: no imports, on purpose. `data-access.ts` needs `parseHealingDice`
 * to filter healing consumables, and importing it from `combat-item-service.ts`
 * would pull db/client, CombatHPService and InventoryConsumableService into the
 * data-access leaf (and invite a cycle if CombatHPService ever reaches back to
 * data-access). The resolver imports from here too, so both call sites share the
 * one parser.
 */

export interface HealingDice {
  count: number;
  sides: number;
  modifier: number;
}

const HEALING_DICE_PATTERN = /^\s*(\d+)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

export function parseHealingDice(value: unknown): HealingDice | null {
  if (typeof value !== 'string') return null;
  const match = HEALING_DICE_PATTERN.exec(value);
  if (!match) return null;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3].replace(/\s+/g, '')) : 0;
  if (count < 1 || sides < 1) return null;
  return { count, sides, modifier };
}

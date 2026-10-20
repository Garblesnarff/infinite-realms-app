import { abilityModifier } from './ability-modifier';
import {
  describeArmorClass,
  isSrdArmorOrShieldName,
  type ArmorClassEquipmentItem,
} from './armor-class';
import { isCatalogWeaponName } from './equipment-weapon-resolver';

function equipmentItemName(item: Record<string, unknown>): string {
  return typeof item.item_name === 'string' ? item.item_name : '';
}

/**
 * Level-1 HP and armour class live in shared/ now (#620): the server and the
 * creation preview call the same helpers, so the two cannot drift apart.
 */

/**
 * Armour class, server-side (#620). Unarmoured Defence (Barbarian +CON, Monk
 * +WIS) applies only when no armour is worn; a Monk also loses it while
 * using a shield. Everything else defers to the shared equipment rule.
 */
export function computeServerArmorClass(
  className: string | null | undefined,
  scores: {
    dexterity?: number | null;
    constitution?: number | null;
    wisdom?: number | null;
  },
  equipment: ArmorClassEquipmentItem[],
  fightingStyles?: unknown,
): number {
  const breakdown = describeArmorClass(equipment, abilityModifier(scores.dexterity ?? 10), {
    fightingStyles,
  });
  const normalized = (className ?? '').trim().toLowerCase();
  const hasUnarmoredDefense =
    !breakdown.armor && (normalized === 'barbarian' || normalized === 'monk');
  if (!hasUnarmoredDefense) return breakdown.armorClass;
  // A Monk's Unarmoured Defence stops working with a shield; the shield's +2
  // from the equipment rule still applies.
  if (normalized === 'monk' && breakdown.shieldBonus > 0) return breakdown.armorClass;
  return (
    breakdown.armorClass +
    abilityModifier((normalized === 'barbarian' ? scores.constitution : scores.wisdom) ?? 10)
  );
}

/**
 * Starting packages arrive with equipped: false (#710). Wear SRD armour, a shield, and the
 * first catalog weapon. Leave the rest carried. An item the caller already marked equipped
 * stays that way, and a second weapon is not worn when one already is. Create only — an
 * update that unequips must stick.
 */
export function withStartingPackageEquipped(
  equipment: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  let woreWeapon = equipment.some(
    (item) => item.equipped === true && isCatalogWeaponName(equipmentItemName(item)),
  );
  return equipment.map((item) => {
    if (item.equipped === true) return item;
    const name = equipmentItemName(item);
    if (isSrdArmorOrShieldName(name)) return { ...item, equipped: true };
    if (!woreWeapon && isCatalogWeaponName(name)) {
      woreWeapon = true;
      return { ...item, equipped: true };
    }
    return item;
  });
}

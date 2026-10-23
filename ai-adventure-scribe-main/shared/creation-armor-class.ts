import { abilityModifier } from './ability-modifier';
import {
  describeArmorClass,
  isSrdArmorOrShieldName,
  type ArmorClassEquipmentItem,
} from './armor-class';
import { isCatalogWeaponName, isRangedWeaponName } from './equipment-weapon-resolver';

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
 * using a shield. A Draconic Bloodline sorcerer's Draconic Resilience
 * (unarmoured base 13) is part of the shared equipment rule. Everything else
 * defers to the shared equipment rule.
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
  draconicBloodline = false,
): number {
  const normalized = (className ?? '').trim().toLowerCase();
  const breakdown = describeArmorClass(equipment, abilityModifier(scores.dexterity ?? 10), {
    fightingStyles,
    // Draconic Resilience belongs to sorcerers; the choice string alone
    // must not raise another class's unarmoured base.
    draconicResilience: draconicBloodline && normalized === 'sorcerer',
  });
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
  const mapped = equipment.map((item) => {
    if (item.equipped === true) return item;
    const name = equipmentItemName(item);
    if (isSrdArmorOrShieldName(name)) return { ...item, equipped: true };
    if (!woreWeapon && isCatalogWeaponName(name)) {
      woreWeapon = true;
      return { ...item, equipped: true };
    }
    return item;
  });
  // #1059: a package's main ranged weapon (the light crossbow, the shortbow)
  // is equipped at create when no melee weapon is equipped in the main hand —
  // the pass above can leave it carried when the one weapon slot went to a
  // caller-equipped ranged weapon instead. When a melee weapon IS equipped,
  // the ranged weapon stays carried and the attack picker offers it as an
  // 'equip and attack' choice instead.
  const hasMeleeEquipped = mapped.some(
    (item) =>
      item.equipped === true &&
      isCatalogWeaponName(equipmentItemName(item)) &&
      !isRangedWeaponName(equipmentItemName(item)),
  );
  if (hasMeleeEquipped) return mapped;
  const mainRanged = mapped.find(
    (item) => item.equipped !== true && isRangedWeaponName(equipmentItemName(item)),
  );
  if (!mainRanged) return mapped;
  return mapped.map((item) => (item === mainRanged ? { ...item, equipped: true } : item));
}

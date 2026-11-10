import type { Character, CharacterBackground } from '@/types/character';

/** Matches the Starting Gold card's index in EquipmentSelection.tsx (GOLD_OPTION_INDEX). */
export const STARTING_GOLD_OPTION_INDEX = 1;

const BARE_GOLD_ITEM = /^\s*(\d+)\s*gp\s*$/i;

/**
 * Gaming-kit item names a background's default kit can be (Soldier ships
 * "Deck of cards"). A chosen gaming set replaces any of these rather than
 * being appended alongside them (#1402).
 */
export const GAMING_KIT_ITEM_NAMES = ['Deck of cards', 'Dice set'] as const;

/**
 * Splits bare coin strings ("10 gp", from a background kit) out of an equipment name list.
 * The create path does the same split on the server (#971): coins become gold, never items.
 */
export function splitBareGold(names: string[]): { items: string[]; bareGold: number } {
  let bareGold = 0;
  const items: string[] = [];
  for (const name of names) {
    const match = BARE_GOLD_ITEM.exec(name);
    if (match) bareGold += Number(match[1]);
    else items.push(name);
  }
  return { items, bareGold };
}

/**
 * The starting gold a wizard choice grants: the rolled or average purse, plus any coins
 * carried in the equipment list (background kit).
 */
export function startingGoldFor(character: Character | null | undefined): number {
  const { bareGold } = splitBareGold(character?.equipment ?? []);
  return (character?.currency?.gp ?? 0) + bareGold;
}

/**
 * Resolves the chosen gaming-kit item name from a tool-proficiency list.
 */
export function resolveGamingKit(
  toolProficiencies: string[] | null | undefined,
): string | undefined {
  if (toolProficiencies?.includes('Gaming set (cards)')) return 'Deck of cards';
  if (toolProficiencies?.includes('Gaming set (dice)')) return 'Dice set';
  return undefined;
}

/**
 * Shared producer for a background's equipment list (#1402): applies the
 * replace-or-keep-default (and add-if-no-default) rule for a chosen gaming
 * set, so the displayed list, the character.equipment array written during
 * creation, and the Finalize summary all agree.
 */
export function resolveBackgroundEquipment(
  background: CharacterBackground | null | undefined,
  toolProficiencies?: string[] | null,
): string[] {
  const base = [...(background?.equipment ?? [])];
  const tools = toolProficiencies ?? background?.toolProficiencies ?? [];
  const chosen = resolveGamingKit(tools);

  if (!chosen) return base;

  const result: string[] = [];
  let inserted = false;
  for (const name of base) {
    if ((GAMING_KIT_ITEM_NAMES as readonly string[]).includes(name)) {
      if (!inserted) {
        result.push(chosen);
        inserted = true;
      }
      continue;
    }
    result.push(name);
  }
  if (!inserted) result.push(chosen);

  // Drop any duplicate copies of the chosen kit that survived.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const name of result) {
    const key = name.toLowerCase();
    if ((GAMING_KIT_ITEM_NAMES as readonly string[]).includes(name) && seen.has(key)) continue;
    seen.add(key);
    deduped.push(name);
  }
  return deduped;
}

/**
 * One line for the Finalize summary: lists the resolved item names and the
 * starting gold. Background items are included (they live in equipment).
 */
export function describeStartingEquipment(character: Character | null | undefined): string {
  if (!character || character.selectedEquipmentOptionIndex === undefined) {
    return 'No equipment chosen';
  }
  const gold = startingGoldFor(character);
  const itemNames = splitBareGold(character.equipment ?? []).items;
  if (character.selectedEquipmentOptionIndex === STARTING_GOLD_OPTION_INDEX) {
    const suffix = itemNames.length ? ` (${itemNames.join(', ')})` : '';
    return `Starting Gold: ${gold} gp, no equipment package${suffix}`;
  }
  const label = character.class?.name
    ? `${character.class.name} Equipment Package`
    : 'Equipment Package';
  return `${label}: ${itemNames.join(', ')}, ${gold} gp starting gold`;
}

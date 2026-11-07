import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';

/** Matches the Starting Gold card's index in EquipmentSelection.tsx (GOLD_OPTION_INDEX). */
export const STARTING_GOLD_OPTION_INDEX = 1;

const BARE_GOLD_ITEM = /^\s*(\d+)\s*gp\s*$/i;

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
 * One line for the Finalize summary: the chosen package, its item count and the starting gold.
 * Background items are not counted as package items.
 */
export function describeStartingEquipment(character: Character | null | undefined): string {
  if (!character || character.selectedEquipmentOptionIndex === undefined) {
    return 'No equipment chosen';
  }
  const gold = startingGoldFor(character);
  if (character.selectedEquipmentOptionIndex === STARTING_GOLD_OPTION_INDEX) {
    return `Starting Gold: ${gold} gp, no equipment package`;
  }
  const backgroundCount =
    backgrounds.find((b) => b.id === character.background?.id)?.equipment?.length ?? 0;
  const packageNames = splitBareGold((character.equipment ?? []).slice(backgroundCount)).items;
  const label = character.class?.name
    ? `${character.class.name} Equipment Package`
    : 'Equipment Package';
  const count = packageNames.length;
  return `${label}, ${count} ${count === 1 ? 'item' : 'items'}, ${gold} gp starting gold`;
}

/**
 * `character_equipment` is the source of truth for gear the sheet owns.
 * An `inventory_items` row with the same name is a copy (story grant or
 * create-time mirror) and must not be read again as a second item.
 */

export function sheetItemNameSet(names: Iterable<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const name of names) {
    const key = name?.trim().toLowerCase();
    if (key) set.add(key);
  }
  return set;
}

export function isAlreadyOnSheet(
  sheetNames: Set<string>,
  name: string | null | undefined,
): boolean {
  const key = name?.trim().toLowerCase();
  return key !== undefined && key.length > 0 && sheetNames.has(key);
}

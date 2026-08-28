/**
 * Read the comma-separated proficiency columns stored on `characters`.
 *
 * Character creation and starter seeding use different comma spacing, and older
 * rows contain both casing and underscore variants. Comparisons therefore use
 * the same canonical key as the frontend roll rules without rewriting stored data.
 */
export function parseProficiencyList(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map((entry) => String(entry))
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

export function canonicalProficiencyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function hasProficiency(values: Iterable<string> | null | undefined, name: string): boolean {
  const target = canonicalProficiencyKey(name);
  if (target.length === 0) return false;
  return [...(values ?? [])].some((value) => canonicalProficiencyKey(value) === target);
}

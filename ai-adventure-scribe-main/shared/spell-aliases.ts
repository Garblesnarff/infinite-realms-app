/**
 * One canonical spell id per spell (#254).
 *
 * The catalog carried two spells twice: the SRD row under its short name
 * ("Hideous Laughter", "Floating Disk") and the supplement row under the
 * PHB possessive form ("Tasha's Hideous Laughter", "Tenser's Floating
 * Disk"). The SRD id is canonical; the possessive form is an alias that
 * maps to it everywhere a spell reference is resolved, so a cast named
 * under either form matches a character recorded under the other, and
 * either form saves to the same `character_spells` row.
 *
 * Keys are the slug forms that actually arrive: the old catalog slug
 * ("tashas-hideous-laughter") and the slugified display name
 * ("tasha-s-hideous-laughter"). `canonicalSpellId` tries the raw ref
 * first, then its slug, so both forms resolve.
 *
 * RETIRED_SPELL_UUIDS covers `character_spells` rows written before the
 * dedupe: a row holding the retired duplicate UUID still reads as the
 * canonical spell. Rewriting those rows is a data migration that needs
 * Rob's line; until then they resolve here, not by rewriting data.
 */
export const SPELL_ID_ALIASES: Record<string, string> = {
  'tashas-hideous-laughter': 'hideous-laughter',
  'tasha-s-hideous-laughter': 'hideous-laughter',
  'tensers-floating-disk': 'floating-disk',
  'tenser-s-floating-disk': 'floating-disk',
};

/** Retired duplicate catalog UUID -> canonical frontend slug. */
export const RETIRED_SPELL_UUIDS: Record<string, string> = {
  '2f531b61-5626-5b7b-a9f9-bf935e580864': 'hideous-laughter',
  'ce62cea7-640b-5439-a175-10289409f59b': 'floating-disk',
};

const slugifySpellRef = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Map a spell reference (slug, display name, or old catalog id) to its canonical id. */
export function canonicalSpellId(ref: string): string {
  return SPELL_ID_ALIASES[ref] ?? SPELL_ID_ALIASES[slugifySpellRef(ref)] ?? ref;
}

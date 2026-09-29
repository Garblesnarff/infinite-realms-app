import { playerCombatSpellLabel, resolvePlayerCombatSpell } from './player-combat-spell';

/**
 * The spell the player's own message declared, read from the tag the character sheet's Cast
 * button writes: `I cast Burning Hands [spell_id=burning-hands, spell_level=level 1].`
 *
 * Only the tag counts. Free text ("I hurl fire at him") is the DM's to interpret; the tag is the
 * player pressing a button that names exactly one spell, and that declaration has to end in an
 * engine line whatever the DM does with it (#2304).
 */
export function declaredSheetSpell(
  message: string | null | undefined,
): { spellId: string; spellName: string } | null {
  if (!message) return null;
  const tagged = /\bI cast (.+?)\s*\[spell_id=([^,\]\s]+)/i.exec(message);
  if (!tagged) return null;
  const [, name, spellId] = tagged;
  return { spellId, spellName: playerCombatSpellLabel(spellId, name.trim()) };
}

/**
 * One spell's identity across the spellings the DM, the sheet, and the engine use: the scoped
 * catalog id when it is a combat spell, else the same slug rule the server's
 * `resolveCatalogSpell` applies (`chill_touch`, `Chill Touch`, and `chill-touch` are one spell).
 */
export function spellIdentity(spell: string | null | undefined): string {
  const raw = (spell ?? '').trim();
  const scoped = resolvePlayerCombatSpell(raw, raw);
  if (scoped) return scoped.id;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const isSameSpell = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => !!spellIdentity(left) && spellIdentity(left) === spellIdentity(right);

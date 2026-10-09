/**
 * #217 step d1: the spell columns the starter-campaign seeder writes for The Apprentice, the
 * Academy of Arcane Gastronomy's level-1 Wizard (INT 16) that Hark's RP-13/14/15 probes played.
 *
 * Producer: `buildStarterCharacterSeed()` in
 * `src/services/character/starter-character-seeding.ts` (called through
 * `seedStarterCharacter()`), which posts these strings to the character-create route, which stores
 * them in `characters.cantrips`, `known_spells` (a wizard's spellbook) and `prepared_spells`.
 *
 * Shared on purpose. The client test asserts the seeder emits exactly these values; the server
 * test seeds the character with them and plays casts through the real DM turn route.
 */
export const apprenticeSpellLists = {
  cantrips: 'acid-splash, chill-touch, dancing-lights',
  known_spells:
    'alarm, burning-hands, charm-person, color-spray, comprehend-languages, detect-magic',
  prepared_spells: 'alarm, burning-hands, charm-person, color-spray',
} as const;

/**
 * The same producer for The Apprentice's template at level 2: two more spellbook spells, and
 * Disguise Self and Expeditious Retreat (neither a ritual) are in the spellbook but not prepared.
 */
export const apprenticeLevel2SpellLists = {
  cantrips: 'acid-splash, chill-touch, dancing-lights',
  known_spells:
    'alarm, burning-hands, charm-person, color-spray, comprehend-languages, detect-magic, disguise-self, expeditious-retreat',
  prepared_spells: 'alarm, burning-hands, charm-person, color-spray, comprehend-languages',
} as const;

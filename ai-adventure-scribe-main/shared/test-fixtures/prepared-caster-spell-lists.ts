/**
 * #217 step d2: what the character-creation wizard saves for three casters:
 * - a level-1 Cleric who picked Bless, Guiding Bolt and Shield of Faith and prepared only Bless;
 * - a level-2 Paladin who picked Bless and Command and prepared only Bless;
 * - a level-1 Bard (a known caster, who prepares nothing) who picked Healing Word.
 *
 * Producers:
 * - the `characters` spell columns: `transformCharacterForStorage()` in `src/types/character.ts`,
 *   which joins the wizard's arrays with ",": `cantrips` and `knownSpells` hold the kebab-case
 *   ids `useSpellSelection` picks, and `preparedSpells` holds names (`useAdvancedSpellcasting`,
 *   #2710);
 * - the `character_spells` rows: `CharacterSpellService.saveCharacterSpells()` in
 *   `server-bun/src/services/character/character-spell-service.ts`, which writes `is_prepared`
 *   per spell from the `prepared` set the wizard posts (#232). Every picked spell gets a row.
 *
 * Shared on purpose. The client test asserts the wizard's storage transform emits exactly these
 * columns; the server test seeds them, writes the rows through the real service, and plays casts
 * through the real DM turn route.
 */
export interface CreationWizardSpells {
  cantrips: readonly string[];
  knownSpells: readonly string[];
  preparedSpells: readonly string[];
  columns: { cantrips: string; known_spells: string; prepared_spells: string };
}

export const creationClericSpells: CreationWizardSpells = {
  cantrips: ['guidance', 'sacred-flame'],
  knownSpells: ['bless', 'guiding-bolt', 'shield-of-faith'],
  preparedSpells: ['Bless'],
  columns: {
    cantrips: 'guidance,sacred-flame',
    known_spells: 'bless,guiding-bolt,shield-of-faith',
    prepared_spells: 'Bless',
  },
};

export const creationPaladinSpells: CreationWizardSpells = {
  cantrips: [],
  knownSpells: ['bless', 'command'],
  preparedSpells: ['Bless'],
  columns: { cantrips: '', known_spells: 'bless,command', prepared_spells: 'Bless' },
};

export const creationBardSpells: CreationWizardSpells = {
  cantrips: ['vicious-mockery'],
  knownSpells: ['healing-word'],
  preparedSpells: [],
  columns: { cantrips: 'vicious-mockery', known_spells: 'healing-word', prepared_spells: '' },
};

/**
 * The Herbalist, the Academy of Arcane Gastronomy's level-1 Druid (WIS 16), as the starter seeder
 * writes them. Producer: `buildStarterCharacterSeed()` in
 * `src/services/character/starter-character-seeding.ts`. A prepared caster's seed has no known
 * list: the prepared list is all there is.
 */
export const herbalistSpellLists = {
  cantrips: 'druidcraft, guidance',
  known_spells: '',
  prepared_spells: 'animal-friendship, charm-person, create-or-destroy-water, cure-wounds',
} as const;

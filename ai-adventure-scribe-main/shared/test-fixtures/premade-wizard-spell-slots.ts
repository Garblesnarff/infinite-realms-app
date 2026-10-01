/**
 * #2459: the exact `spell_slots` value the starter-campaign seeder emits for a
 * level-1 wizard premade.
 *
 * Producer: `buildStarterCharacterSeed()` in
 * `src/services/character/starter-character-seeding.ts` (called through
 * `seedStarterCharacter()` from `use-character-selection.ts`), which stores
 * this value in `characters.spell_slots` at character creation. The value must
 * be in the `{ level: { max, current } }` shape the sheet parses; the old
 * `spell_slots_N` keys were silently dropped by the parser, so premade casters
 * showed computed slots while the engine found no slot rows and refused
 * every levelled cast.
 *
 * Shared on purpose. The client test asserts the seeder emits exactly this
 * value, and the server tests post this same value through the real
 * character-create route and the real engine. A mocked API does not count
 * (#2250's tests mocked it, and the body they approved 422'd in production).
 */
export const premadeWizardSpellSlotsWireValue: Record<string, { max: number; current: number }> = {
  '1': { max: 2, current: 2 },
};

import type { CharacterRace } from '@/types/character';

/**
 * Satyr is used by the Eternal Feast premade "The Reveler" (see
 * supabase/migrations/20260117_update_eternal_feast_characters.sql). It is a lookup-only
 * race: the character sheet needs it to resolve that premade, but it is not offered in
 * the creation wizard (`baseRaces`).
 */
export const satyr: CharacterRace = {
  id: 'satyr',
  name: 'Satyr',
  description:
    'Horned, hoofed fey who live for revelry, music and the thrill of the moment, satyrs wander out of the Feywild in search of new celebrations.',
  traits: ['Fey', 'Ram', 'Magic Resistance', 'Mirthful Leaps', 'Reveler'],
  abilityScoreIncrease: { charisma: 2, dexterity: 1 },
  speed: 35,
  languages: ['Common', 'Sylvan'],
  subraces: [],
};

import type { Character } from '@/types/character';

import { classes } from '@/data/classOptions';
import { baseRaces } from '@/data/raceOptions';

/**
 * Transforms raw database character data into Character type
 * @param rawData - Raw character data from database
 * @returns Transformed character data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing; restyle-only change
export function transformCharacterData(rawData: any[]): Partial<Character>[] {
  return rawData.map((char) => {
    const baseRace = baseRaces.find((r) => r.name === char.race);
    const subrace = baseRace?.subraces?.find((s) => s.name === char.subrace);
    return {
      ...char,
      race: baseRace || { name: char.race, subraces: [] },
      subrace: subrace || null,
      class: classes.find((c) => c.name === char.class) || { name: char.class },
    };
  });
}

import type { Subrace } from '@/types/character';

/**
 * Get racial bonus spells for a character
 */
export function getRacialSpells(
  race: string,
  subrace?: Subrace,
): { cantrips: string[]; spells: string[]; bonusCantrips: number; bonusCantripSource?: string } {
  // Default empty response
  const result = {
    cantrips: [] as string[],
    spells: [] as string[],
    bonusCantrips: 0,
    bonusCantripSource: undefined as string | undefined,
  };

  // Get spells from subrace data if available
  if (subrace) {
    if (subrace.cantrips) {
      result.cantrips = [...subrace.cantrips];
    }
    if (subrace.spells) {
      result.spells = [...subrace.spells];
    }
    if (subrace.bonusCantrip) {
      result.bonusCantrips = subrace.bonusCantrip.count;
      result.bonusCantripSource = subrace.bonusCantrip.source;
    }
  }

  // Fallback to hardcoded mapping for backwards compatibility
  const racialSpells: Record<
    string,
    { cantrips: string[]; spells: string[]; bonusCantrips?: number; bonusCantripSource?: string }
  > = {
    'High Elf': {
      cantrips: [],
      spells: [],
      bonusCantrips: 1,
      bonusCantripSource: 'wizard',
    },
    Drow: {
      cantrips: ['dancing-lights'],
      spells: [], // Gets Faerie Fire and Darkness at higher levels
    },
    'Forest Gnome': {
      cantrips: ['minor-illusion'],
      spells: [],
    },
    Tiefling: {
      cantrips: ['thaumaturgy'],
      spells: [], // Gets Hellish Rebuke at 3rd level, Darkness at 5th level
    },
  };

  // Check subrace first, then race for fallback
  const subraceKey = subrace?.name;
  if (subraceKey && racialSpells[subraceKey]) {
    const fallback = racialSpells[subraceKey];
    if (result.cantrips.length === 0 && fallback.cantrips) {
      result.cantrips = [...fallback.cantrips];
    }
    if (result.spells.length === 0 && fallback.spells) {
      result.spells = [...fallback.spells];
    }
    if (result.bonusCantrips === 0 && fallback.bonusCantrips) {
      result.bonusCantrips = fallback.bonusCantrips;
      result.bonusCantripSource = fallback.bonusCantripSource;
    }
  } else if (racialSpells[race]) {
    const fallback = racialSpells[race];
    if (result.cantrips.length === 0 && fallback.cantrips) {
      result.cantrips = [...fallback.cantrips];
    }
    if (result.spells.length === 0 && fallback.spells) {
      result.spells = [...fallback.spells];
    }
    if (result.bonusCantrips === 0 && fallback.bonusCantrips) {
      result.bonusCantrips = fallback.bonusCantrips;
      result.bonusCantripSource = fallback.bonusCantripSource;
    }
  }

  return result;
}

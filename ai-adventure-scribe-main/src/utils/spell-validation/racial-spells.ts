import type { Subrace } from '@/types/character';

/**
 * Get racial bonus spells for a character
 */
export function getRacialSpells(
  race: string,
  subrace?: Subrace,
  level: number = 1,
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
      // Traditionally racial spells from data are unlocked at specific levels
      // For now, if level is not specified we assume level 1
      result.spells = [...subrace.spells];
    }
    if (subrace.bonusCantrip) {
      result.bonusCantrips = subrace.bonusCantrip.count;
      result.bonusCantripSource = subrace.bonusCantrip.source;
    }
  }

  // Fallback to hardcoded mapping for backwards compatibility and level-based unlocks
  const racialSpells: Record<
    string,
    {
      cantrips: string[];
      spells: string[];
      bonusCantrips?: number;
      bonusCantripSource?: string;
      levelUnlocks?: Array<{ level: number; spells?: string[]; cantrips?: string[] }>;
    }
  > = {
    'High Elf': {
      cantrips: [],
      spells: [],
      bonusCantrips: 1,
      bonusCantripSource: 'wizard',
    },
    Drow: {
      cantrips: ['dancing-lights'],
      spells: [],
      levelUnlocks: [
        { level: 3, spells: ['faerie-fire'] },
        { level: 5, spells: ['darkness'] },
      ],
    },
    'Forest Gnome': {
      cantrips: ['minor-illusion'],
      spells: [],
    },
    Tiefling: {
      cantrips: ['thaumaturgy'],
      spells: [],
      levelUnlocks: [
        { level: 3, spells: ['hellish-rebuke'] },
        { level: 5, spells: ['darkness'] },
      ],
    },
  };

  // Helper to apply fallback data
  const applyFallback = (key: string) => {
    const fallback = racialSpells[key];
    if (!fallback) return;

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

    // Apply level-based unlocks
    if (fallback.levelUnlocks) {
      fallback.levelUnlocks.forEach((unlock) => {
        if (level >= unlock.level) {
          if (unlock.spells) {
            result.spells = [...new Set([...result.spells, ...unlock.spells])];
          }
          if (unlock.cantrips) {
            result.cantrips = [...new Set([...result.cantrips, ...unlock.cantrips])];
          }
        }
      });
    }
  };

  // Check subrace first, then race for fallback
  const subraceKey = subrace?.name;
  if (subraceKey && racialSpells[subraceKey]) {
    applyFallback(subraceKey);
  } else if (racialSpells[race]) {
    applyFallback(race);
  }

  return result;
}

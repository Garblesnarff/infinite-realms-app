import type { Character } from '@/types/character';

type StatsRow = {
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
  armor_class?: number | null;
  max_hit_points?: number | null;
  current_hit_points?: number | null;
};

/** Copy the stored stats row onto the character the sheet and stat bar read. */
export function hydrateCharacterStats(
  stats: StatsRow | null | undefined,
): Character['character_stats'] {
  if (!stats) return undefined;
  return {
    strength: stats.strength,
    dexterity: stats.dexterity,
    constitution: stats.constitution,
    intelligence: stats.intelligence,
    wisdom: stats.wisdom,
    charisma: stats.charisma,
    armor_class: stats.armor_class ?? undefined,
    max_hit_points: stats.max_hit_points ?? undefined,
    current_hit_points: stats.current_hit_points ?? undefined,
  };
}

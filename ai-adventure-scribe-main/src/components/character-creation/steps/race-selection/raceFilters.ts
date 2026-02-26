/**
 * Race Selection Filters
 * Category definitions and filtering logic for race selection
 */

import type { CharacterRace } from '@/types/character';

/**
 * Race category definition
 */
export interface RaceCategory {
  id: string;
  name: string;
  raceIds: string[];
}

/**
 * Category definitions for race filtering
 */
export const RACE_CATEGORY_DEFINITIONS: Record<string, string[]> = {
  core: ['human', 'elf', 'dwarf', 'halfling', 'dragonborn', 'half-elf', 'half-orc'],
  exotic: ['tiefling', 'gnome', 'elementalborn', 'celestialborn', 'astralborn'],
  planar: ['celestialborn', 'astralborn', 'tiefling'],
};

/**
 * Build race categories with counts
 */
export function buildRaceCategories(races: CharacterRace[]): Array<{
  id: string;
  name: string;
  count: number;
}> {
  return [
    { id: 'all', name: 'All Races', count: races.length },
    {
      id: 'core',
      name: 'Core Races',
      count: races.filter((r) => RACE_CATEGORY_DEFINITIONS.core.includes(r.id)).length,
    },
    {
      id: 'exotic',
      name: 'Exotic Races',
      count: races.filter((r) => RACE_CATEGORY_DEFINITIONS.exotic.includes(r.id)).length,
    },
    {
      id: 'planar',
      name: 'Planar Races',
      count: races.filter((r) => RACE_CATEGORY_DEFINITIONS.planar.includes(r.id)).length,
    },
  ];
}

/**
 * Filter races by search query and category
 */
export function filterRaces(
  races: CharacterRace[],
  searchQuery: string,
  category: string,
): CharacterRace[] {
  let filtered = races;

  // Apply search filter
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (race) =>
        race.name.toLowerCase().includes(query) ||
        race.description.toLowerCase().includes(query) ||
        race.traits.some((trait) => trait.toLowerCase().includes(query)),
    );
  }

  // Apply category filter
  if (category !== 'all') {
    const categoryRaceIds = RACE_CATEGORY_DEFINITIONS[category];
    if (categoryRaceIds) {
      filtered = filtered.filter((race) => categoryRaceIds.includes(race.id));
    }
  }

  return filtered;
}

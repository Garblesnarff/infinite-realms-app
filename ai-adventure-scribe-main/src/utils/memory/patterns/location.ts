import type { ClassificationPattern } from './types';

export const locationPatterns: ClassificationPattern = {
  type: 'location',
  patterns: [
    // Named locations and realms
    'village',
    'town',
    'city',
    'realm',
    'kingdom',
    'land',
    // Structures and buildings
    'castle',
    'fortress',
    'temple',
    'cottage',
    'house',
    'tavern',
    // Natural locations
    'forest',
    'mountain',
    'cave',
    'valley',
    'river',
    // Parts of locations
    'gate',
    'door',
    'bridge',
    'road',
    'path',
    // Area descriptors
    'district',
    'quarter',
    'region',
    'area',
    'domain',
  ],
  contextPatterns: [
    // Matches "X of Y" where Y is likely a location name
    /(?:village|town|city|realm) of [A-Z][a-z]+/,
    // Matches location descriptions
    /(?:ancient|old|abandoned|sacred|cursed|hidden) (?:temple|fortress|castle|grove)/,
    // Matches named locations
    /[A-Z][a-z]+ (?:Woods|Mountains|Valley|Keep|Castle|Village|Town)/,
  ],
  importance: 7,
};

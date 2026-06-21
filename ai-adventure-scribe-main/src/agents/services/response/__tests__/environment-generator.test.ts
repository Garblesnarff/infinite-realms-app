/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { EnvironmentGenerator } from '../environment-generator';

import type { Character } from '@/types/character';
import type { CampaignContext } from '@/types/dm';

describe('EnvironmentGenerator', () => {
  let generator: EnvironmentGenerator;

  beforeEach(() => {
    generator = new EnvironmentGenerator();
    vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockCharacter: Character = {
    id: 'char-123',
    name: 'Test Hero',
    race: 'Human',
    class: 'Fighter',
    level: 1,
    stats: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    hp: { current: 10, max: 10 },
  } as any;

  const mockContext: CampaignContext = {
    setting: {
      location: 'Neverwinter',
      atmosphere: 'peaceful',
      thematicElements: {
        keyLocations: [],
        factions: [],
        conflicts: [],
      },
    },
  } as any;

  it('should generate a basic environment description', () => {
    (Math.random as any).mockReturnValue(0.5); // 'dusk' (index 3 out of 6: floor(0.5 * 6) = 3)
    // times = ['dawn', 'morning', 'afternoon', 'dusk', 'twilight', 'night']

    const result = generator.generateEnvironment(mockContext, mockCharacter);

    expect(result.atmosphere).toBe('peaceful');
    expect(result.description).toContain('dusk settles over Neverwinter');
    expect(result.description).toContain('a gentle breeze carries hints of adventure');
    expect(result.description).toContain('You take in the surroundings with careful consideration');
  });

  it('should handle dark and foreboding atmosphere', () => {
    (Math.random as any).mockReturnValue(0.99); // 'night'
    const darkContext = {
      ...mockContext,
      setting: {
        ...mockContext.setting,
        atmosphere: 'Dark and Foreboding',
      },
    };

    const result = generator.generateEnvironment(darkContext, mockCharacter);

    expect(result.description).toContain('overcast skies cast long shadows');
    expect(result.sensoryDetails).toContain('Shadows seem to move with a life of their own');
    expect(result.sensoryDetails).toContain('A chill wind carries echoes of distant sounds');
  });

  it('should handle mysterious atmosphere', () => {
    (Math.random as any).mockReturnValue(0); // 'dawn'
    const mysteriousContext = {
      ...mockContext,
      setting: {
        ...mockContext.setting,
        atmosphere: 'mysterious',
      },
    };

    const result = generator.generateEnvironment(mysteriousContext, mockCharacter);

    expect(result.description).toContain('a light mist curls around your feet');
    expect(result.sensoryDetails).toContain('Whispered conversations fade as you pass');
    expect(result.sensoryDetails).toContain('The air tingles with untold secrets');
  });

  it('should provide wizard-specific details', () => {
    const wizardCharacter = {
      ...mockCharacter,
      class: 'Wizard',
    };

    const result = generator.generateEnvironment(mockContext, wizardCharacter as any);

    expect(result.description).toContain('Your arcane senses tingle');
    expect(result.sensoryDetails).toContain('Your magical attunement reveals subtle flows of arcane energy');
  });

  it('should provide race-specific descriptions for Dragonborn', () => {
    const dragonborn = {
      ...mockCharacter,
      race: 'Dragonborn',
    };

    const result = generator.generateEnvironment(mockContext, dragonborn as any);

    expect(result.description).toContain('Your scales shimmer in the ambient light');
  });

  it('should provide race-specific descriptions for Elf', () => {
    const elf = {
      ...mockCharacter,
      race: 'Elf',
    };

    const result = generator.generateEnvironment(mockContext, elf as any);

    expect(result.description).toContain('Your keen elven senses pick up subtle details');
  });

  it('should handle complex class/race objects', () => {
    const complexChar = {
      ...mockCharacter,
      class: { name: 'Wizard' },
      race: { name: 'Elf' },
    };

    const result = generator.generateEnvironment(mockContext, complexChar as any);

    expect(result.description).toContain('Your arcane senses tingle');
    expect(result.description).toContain('Your keen elven senses pick up subtle details');
  });

  it('should handle undefined setting', () => {
    const emptyContext: CampaignContext = {} as any;
    const result = generator.generateEnvironment(emptyContext, mockCharacter);

    expect(result.atmosphere).toBe('neutral');
    expect(result.description).toContain('settles over the area');
    expect(result.sensoryDetails).toEqual(['The environment feels ordinary but watchful.']);
  });
});

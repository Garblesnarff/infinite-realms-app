import { describe, expect, it } from 'vitest';

import {
  EXPECTED_AFFECTED_CHARACTER_COUNT,
  findAffectedCharacters,
  formatAbilityScoreBackfillPlan,
  parseCliArgs,
  planAbilityScoreBackfill,
} from '../scripts/backfill-academy-ability-scores';

const SESSIONS = [
  { character_id: 'apprentice-1', starter_campaign_id: 'academy' },
  { character_id: 'sous-chef', starter_campaign_id: 'academy' },
  { character_id: 'other-campaign', starter_campaign_id: 'other-campaign' },
  { character_id: 'hand-built', starter_campaign_id: null },
];

const CHARACTERS = [
  { id: 'apprentice-1', name: 'The Apprentice', class: 'Wizard', level: 1 },
  { id: 'sous-chef', name: 'The Sous Chef', class: 'Sorcerer', level: 1 },
  { id: 'other-campaign', name: 'The Faithful', class: 'Cleric', level: 1 },
  { id: 'hand-built', name: 'Hand Built', class: 'Fighter', level: 1 },
];

const STATS = [
  {
    character_id: 'apprentice-1',
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    armor_class: 10,
    max_hit_points: 10,
    current_hit_points: 10,
  },
  {
    character_id: 'sous-chef',
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    armor_class: 10,
    max_hit_points: 10,
    current_hit_points: 10,
  },
  {
    character_id: 'other-campaign',
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    armor_class: 10,
    max_hit_points: 10,
    current_hit_points: 10,
  },
  {
    character_id: 'hand-built',
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
    armor_class: 15,
    max_hit_points: 10,
    current_hit_points: 10,
  },
];

const TEMPLATES = [
  {
    starter_campaign_id: 'academy',
    template_key: 'the-apprentice',
    name: 'The Apprentice',
    race: 'Human',
    class: 'Wizard',
    ability_scores: { STR: 8, DEX: 12, CON: 12, INT: 16, WIS: 12, CHA: 10 },
  },
  {
    starter_campaign_id: 'academy',
    template_key: 'the-sous-chef',
    name: 'The Sous Chef',
    race: 'Human',
    class: 'Sorcerer',
    ability_scores: {
      strength: 8,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 10,
      charisma: 16,
    },
  },
  {
    starter_campaign_id: 'other-campaign',
    template_key: 'faithful',
    name: 'The Faithful',
    race: 'Human',
    class: 'Cleric',
    ability_scores: { STR: 14, DEX: 10, CON: 14, INT: 10, WIS: 18, CHA: 12 },
  },
  {
    starter_campaign_id: 'other-campaign',
    template_key: 'default-template',
    name: 'Hand Built',
    race: 'Human',
    class: 'Fighter',
    ability_scores: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  },
];

const BASE_INPUT = {
  sessions: SESSIONS,
  characters: CHARACTERS,
  stats: STATS,
  templates: TEMPLATES,
  equipment: [],
  inventory: [],
};

describe('starter ability-score backfill discovery', () => {
  it('scans every starter campaign by template-vs-character score divergence', () => {
    const targets = findAffectedCharacters(SESSIONS, CHARACTERS, STATS, TEMPLATES);

    expect(targets).toEqual([
      { characterId: 'apprentice-1', starterCampaignId: 'academy', templateKey: 'the-apprentice' },
      { characterId: 'sous-chef', starterCampaignId: 'academy', templateKey: 'the-sous-chef' },
      {
        characterId: 'other-campaign',
        starterCampaignId: 'other-campaign',
        templateKey: 'faithful',
      },
    ]);
    expect(targets).toHaveLength(EXPECTED_AFFECTED_CHARACTER_COUNT);
  });

  it('repairs a divergent non-default character, not only six stored 10s', () => {
    const partiallyDivergent = STATS.map((row) =>
      row.character_id === 'apprentice-1' ? { ...row, strength: 8, intelligence: 10 } : row,
    );
    const targets = findAffectedCharacters(SESSIONS, CHARACTERS, partiallyDivergent, TEMPLATES);

    expect(targets).toContainEqual({
      characterId: 'apprentice-1',
      starterCampaignId: 'academy',
      templateKey: 'the-apprentice',
    });
  });
});

describe('starter ability-score backfill planning', () => {
  it('recomputes shared unarmoured AC and level-1 HP and prints old -> new', () => {
    const targets = findAffectedCharacters(SESSIONS, CHARACTERS, STATS, TEMPLATES);
    const [apprentice] = planAbilityScoreBackfill({ ...BASE_INPUT, targets });

    expect(apprentice).toMatchObject({
      characterName: 'The Apprentice',
      previousArmorClass: 10,
      armorClass: 11,
      previousMaxHitPoints: 10,
      previousCurrentHitPoints: 10,
      maxHitPoints: 7,
      currentHitPoints: 7,
      changed: true,
    });
    expect(formatAbilityScoreBackfillPlan(apprentice)).toBe(
      'The Apprentice (apprentice-1) [the-apprentice]: ' +
        'scores strength=10, dexterity=10, constitution=10, intelligence=10, wisdom=10, charisma=10 ' +
        '-> strength=8, dexterity=12, constitution=12, intelligence=16, wisdom=12, charisma=10; ' +
        'AC 10 -> 11; HP 10/10 -> 7/7',
    );
  });

  it('floors current HP without healing a damaged character', () => {
    const targets = findAffectedCharacters(SESSIONS, CHARACTERS, STATS, TEMPLATES);
    const damagedStats = STATS.map((row) =>
      row.character_id === 'sous-chef' ? { ...row, current_hit_points: 4 } : row,
    );
    const [, sousChef] = planAbilityScoreBackfill({
      ...BASE_INPUT,
      stats: damagedStats,
      targets,
    });

    expect(sousChef).toMatchObject({
      previousMaxHitPoints: 10,
      previousCurrentHitPoints: 4,
      maxHitPoints: 8,
      currentHitPoints: 4,
    });
  });
});

describe('starter ability-score backfill CLI', () => {
  it('defaults to dry-run and requires an explicit apply flag', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--apply'])).toEqual({ dryRun: false });
    expect(() => parseCliArgs(['--force'])).toThrow('Unknown option: --force');
  });
});

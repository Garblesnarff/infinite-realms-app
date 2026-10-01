/* eslint-disable max-lines */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { premadeWizardSpellSlotsWireValue } from '../../../../shared/test-fixtures/premade-wizard-spell-slots';
import {
  buildStarterCharacterSeed,
  buildStarterSpellSeed,
  getStarterSpellQuotas,
  getAbilityScores,
  transformStarterInventory,
  transformStarterEquipment,
} from '../starter-character-seeding';

import type { StarterCharacterTemplateLike } from '../starter-character-seeding';

import { mapTemplateRow } from '@/hooks/use-starter-character-templates';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    reportClientFailure: vi.fn(),
  },
}));

const clericTemplate = {
  name: 'The Faithful',
  race: 'Human',
  class: 'Cleric',
  level: 1,
  ability_scores: {
    strength: 14,
    dexterity: 10,
    constitution: 14,
    intelligence: 10,
    wisdom: 18,
    charisma: 12,
  },
  equipment: ['mace', 'scale mail', 'shield', 'an item not in the SRD'],
  skills: ['insight'],
  languages: ['Common'],
  portrait_url: '/images/the-faithful.png',
  card_image_url: '/images/the-faithful-card.png',
};

const academyTemplates = [
  {
    name: 'The Apprentice',
    race: 'Human',
    class: 'Wizard',
    background: 'Sage',
    level: 1,
    ability_scores: { STR: 8, DEX: 12, CON: 12, INT: 16, WIS: 12, CHA: 10 },
    skills: ['Arcana', 'History', 'Investigation', 'Insight'],
    languages: [],
    equipment: [],
  },
  {
    name: 'The Kitchen Hand',
    race: 'Halfling',
    class: 'Rogue',
    background: 'Urchin',
    level: 1,
    ability_scores: { STR: 8, DEX: 16, CON: 12, INT: 12, WIS: 10, CHA: 14 },
    skills: ['Stealth', 'Sleight of Hand', 'Acrobatics', 'Perception'],
    languages: [],
    equipment: [],
  },
  {
    name: 'The Gourmand',
    race: 'Dwarf',
    class: 'Fighter',
    background: 'Folk Hero',
    level: 1,
    ability_scores: { STR: 16, DEX: 12, CON: 16, INT: 8, WIS: 10, CHA: 10 },
    skills: ['Athletics', 'Survival', 'Intimidation', 'Perception'],
    languages: [],
    equipment: [],
  },
  {
    name: 'The Herbalist',
    race: 'Half-Elf',
    class: 'Druid',
    background: 'Hermit',
    level: 1,
    ability_scores: { STR: 10, DEX: 12, CON: 12, INT: 12, WIS: 16, CHA: 12 },
    skills: ['Nature', 'Medicine', 'Survival', 'Perception'],
    languages: [],
    equipment: [],
  },
  {
    name: 'The Sous Chef',
    race: 'Tiefling',
    class: 'Sorcerer',
    background: 'Entertainer',
    level: 1,
    ability_scores: { STR: 8, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 16 },
    skills: ['Arcana', 'Persuasion', 'Deception', 'Performance'],
    languages: [],
    equipment: [],
  },
] as const;

describe('starter-character-seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(academyTemplates)(
    'normalizes the real uppercase Academy template shape for $name',
    (template) => {
      const seed = buildStarterCharacterSeed(template, 'academy-of-arcane-gastronomy');

      expect(seed.stats).toMatchObject({
        strength: template.ability_scores.STR,
        dexterity: template.ability_scores.DEX,
        constitution: template.ability_scores.CON,
        intelligence: template.ability_scores.INT,
        wisdom: template.ability_scores.WIS,
        charisma: template.ability_scores.CHA,
      });
      expect(seed.stats).not.toHaveProperty('STR');
      expect(seed.stats).not.toHaveProperty('INT');
    },
  );

  it('produces identical seeded ability scores from both template entry paths', () => {
    const rawTemplate = academyTemplates[0] as unknown as StarterCharacterTemplateLike;
    const mappedTemplate = mapTemplateRow({
      ...rawTemplate,
      id: 'template-1',
      starter_campaign_id: 'academy-of-arcane-gastronomy',
      template_key: 'the-apprentice',
    });

    expect(buildStarterCharacterSeed(rawTemplate, 'academy').stats).toMatchObject(
      buildStarterCharacterSeed(mappedTemplate, 'academy').stats as Record<string, unknown>,
    );
  });

  it('preserves authored spell preferences when mapping a template row', () => {
    const mappedTemplate = mapTemplateRow({
      ...academyTemplates[0],
      id: 'template-1',
      starter_campaign_id: 'academy-of-arcane-gastronomy',
      template_key: 'the-apprentice',
      spells: { knownSpells: ['shield'], preparedSpells: ['shield'] },
    });

    expect(mappedTemplate.spells).toEqual({
      knownSpells: ['shield'],
      preparedSpells: ['shield'],
    });
  });

  it('normalizes full ability names without regard to casing', () => {
    expect(
      getAbilityScores({
        ...academyTemplates[0],
        ability_scores: {
          sTrEnGtH: 8,
          DeXtErItY: 12,
          CoNsTiTuTiOn: 12,
          InTeLlIgEnCe: 16,
          WiSdOm: 12,
          ChArIsMa: 10,
        },
      }),
    ).toEqual({
      strength: 8,
      dexterity: 12,
      constitution: 12,
      intelligence: 16,
      wisdom: 12,
      charisma: 10,
    });
  });

  it('logs, reports telemetry, and throws for an unrecognized ability score key', () => {
    const template = {
      ...academyTemplates[0],
      ability_scores: { ...academyTemplates[0].ability_scores, LUCK: 18 },
    };

    expect(() => buildStarterCharacterSeed(template, 'academy-of-arcane-gastronomy')).toThrow(
      'Unrecognized ability score key "LUCK"',
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[AbilityScoreNormalization] Invalid starter ability scores',
      expect.objectContaining({
        templateName: 'The Apprentice',
        key: 'LUCK',
        keys: expect.arrayContaining(['STR', 'INT', 'LUCK']),
      }),
    );
    expect(userDataApi.reportClientFailure).toHaveBeenCalledWith(
      'invalid_ability_score_key',
      undefined,
      expect.stringContaining('LUCK'),
    );
  });

  it('transforms known equipment and preserves campaign items as trinket records', () => {
    const equipment = transformStarterEquipment([
      'mace',
      'mace',
      { name: 'an item not in the SRD', description: 'A keepsake from the campaign.' },
    ]);

    expect(equipment).toEqual([
      { item_name: 'Mace', item_type: 'weapon', quantity: 2, equipped: true },
      {
        item_name: 'an item not in the SRD',
        item_type: 'trinket',
        quantity: 1,
        equipped: false,
        weight: 0,
        description: 'A keepsake from the campaign.',
      },
    ]);
    expect(
      transformStarterInventory([
        { name: 'an item not in the SRD', description: 'A keepsake from the campaign.' },
      ]),
    ).toEqual([
      {
        name: 'an item not in the SRD',
        item_type: 'trinket',
        quantity: 1,
        weight: 0,
        description: 'A keepsake from the campaign.',
        is_equipped: false,
      },
    ]);
  });

  it('resolves SRD names across case, pluralization, punctuation, and aliases', () => {
    const equipment = transformStarterEquipment([
      'HANDAXES',
      'priest’s pack',
      'lute',
      'holy symbol',
    ]);

    expect(equipment.map((item) => item.item_name)).toEqual([
      'Handaxe',
      "Priest's Pack",
      'Lute',
      'Amulet',
    ]);
    expect(equipment.every((item) => item.item_type !== 'custom')).toBe(true);
  });

  it('grants arrows and the SRD quiver for the quiver-with-arrows bundle', () => {
    expect(transformStarterEquipment(['quiver with 20 arrows'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_name: 'Arrows (20)', item_type: 'gear', quantity: 1 }),
        expect.objectContaining({ item_name: 'Quiver', item_type: 'gear', quantity: 1 }),
      ]),
    );
  });

  it('uses class data for Cleric cantrips and WIS-based preparation', () => {
    const spells = buildStarterSpellSeed(clericTemplate);

    expect(spells.cantrips).toHaveLength(3);
    expect(spells.knownSpells).toHaveLength(0);
    expect(spells.preparedSpells).toHaveLength(5);
    expect(spells.cantrips.every((id) => id.length > 0)).toBe(true);
  });

  it('keeps the Wizard spellbook quota separate from the prepared quota', () => {
    const template = {
      ...clericTemplate,
      class: 'Wizard',
      ability_scores: { ...clericTemplate.ability_scores, intelligence: 16 },
    };
    const spells = buildStarterSpellSeed(template);

    expect(getStarterSpellQuotas('Wizard', 1, { intelligence: 16 })).toEqual({
      known: 6,
      prepared: 4,
    });
    expect(spells.knownSpells).toHaveLength(6);
    expect(spells.preparedSpells).toHaveLength(4);
    expect(spells.preparedSpells.every((id) => spells.knownSpells.includes(id))).toBe(true);
  });

  it('uses the SRD fixed known progression for known-spell casters', () => {
    expect(getStarterSpellQuotas('Bard', 1, { charisma: 16 })).toEqual({
      known: 4,
      prepared: 0,
    });
    expect(getStarterSpellQuotas('Sorcerer', 1, { charisma: 16 })).toEqual({
      known: 2,
      prepared: 0,
    });
    expect(getStarterSpellQuotas('Warlock', 1, { charisma: 16 })).toEqual({
      known: 2,
      prepared: 0,
    });
    expect(getStarterSpellQuotas('Paladin', 1, { charisma: 18 })).toEqual({
      known: 0,
      prepared: 0,
    });
    expect(getStarterSpellQuotas('Paladin', 2, { charisma: 18 })).toEqual({
      known: 0,
      prepared: 5,
    });
    expect(getStarterSpellQuotas('Ranger', 2, { wisdom: 16 })).toEqual({
      known: 2,
      prepared: 0,
    });
    expect(getStarterSpellQuotas('Ranger', 4, { wisdom: 16 })).toEqual({
      known: 3,
      prepared: 0,
    });
    expect(getStarterSpellQuotas('Ranger', 20, { wisdom: 16 })).toEqual({
      known: 11,
      prepared: 0,
    });
  });

  it('uses an authored class spell before filling the remainder from SRD defaults', () => {
    const seed = buildStarterSpellSeed({
      ...clericTemplate,
      class: 'Warlock',
      spells: { knownSpells: ['arms-of-hadar'] },
    });
    const fallbackSeed = buildStarterSpellSeed({ ...clericTemplate, class: 'Warlock' });

    expect(seed.knownSpells).toEqual(['arms-of-hadar', expect.any(String)]);
    expect(fallbackSeed.knownSpells).not.toContain('arms-of-hadar');
  });

  it.each([
    ['Cleric', 10],
    ['Fighter', 12],
  ])('stores level-1 %s HP from the shared hit die', (characterClass, expectedMaxHitPoints) => {
    const seed = buildStarterCharacterSeed(
      { ...clericTemplate, class: characterClass },
      'campaign-id',
    );

    expect((seed.stats as { max_hit_points: number }).max_hit_points).toBe(expectedMaxHitPoints);
  });

  it('throws for an unsupported class instead of fabricating HP', () => {
    expect(() =>
      buildStarterCharacterSeed({ ...clericTemplate, class: 'Artificer' }, 'campaign-id'),
    ).toThrow('Unsupported SRD class "Artificer"; refusing HP initialization.');
  });

  it('sets both portrait fields and the server-facing spell/equipment fields', () => {
    const seed = buildStarterCharacterSeed(clericTemplate, 'campaign-id');

    expect(seed.image_url).toBe('/images/the-faithful.png');
    expect(seed.avatar_url).toBe('/images/the-faithful.png');
    expect(seed.background_image).toBe('/images/the-faithful-card.png');
    expect(seed.cantrips).toBeTruthy();
    expect(seed.known_spells).toBe('');
    expect(seed.prepared_spells).toBeTruthy();
    expect(seed.equipment).toEqual(
      expect.arrayContaining([expect.objectContaining({ item_name: 'Mace', item_type: 'weapon' })]),
    );
  });

  it('computes armour class from the equipment it just built, not 10 + DEX', () => {
    // #1858: The Faithful shipped at AC 10 in Scale Mail and a Shield. Scale Mail 14, DEX +0
    // (capped at +2 for medium armour anyway), shield +2 — the sheet says 16.
    const seed = buildStarterCharacterSeed(clericTemplate, 'campaign-id');
    const stats = seed.stats as { armor_class: number };

    expect(stats.armor_class).toBe(16);
  });

  it('still falls back to 10 + DEX for a template that carries no armour', () => {
    const seed = buildStarterCharacterSeed(
      {
        ...clericTemplate,
        equipment: ['mace'],
        ability_scores: { ...clericTemplate.ability_scores, dexterity: 16 },
      },
      'campaign-id',
    );
    const stats = seed.stats as { armor_class: number };

    expect(stats.armor_class).toBe(13);
  });

  it('keeps both starter creation call sites on the shared helper', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/pages/StarterCharacterSelectionPage.tsx'),
      'utf8',
    );
    const hook = readFileSync(
      resolve(process.cwd(), 'src/features/campaign/hooks/use-character-selection.ts'),
      'utf8',
    );

    expect(page).toMatch(/import \{ seedStarterCharacter \} from .*starter-character-seeding/);
    expect(hook).toMatch(/import \{ seedStarterCharacter \} from .*starter-character-seeding/);
    expect(page.match(/seedStarterCharacter\(/g)).toHaveLength(1);
    expect(hook.match(/seedStarterCharacter\(/g)).toHaveLength(1);
  });

  describe('starter spell_slots wire shape (#2459)', () => {
    it('emits spell_slots in the sheet-parsed { level: { max, current } } shape for a level-1 wizard premade', () => {
      // The Apprentice (academyTemplates[0]) is a level-1 Wizard.
      const seed = buildStarterCharacterSeed(
        academyTemplates[0] as unknown as StarterCharacterTemplateLike,
        'academy-of-arcane-gastronomy',
      );

      expect(seed.spell_slots).toEqual(premadeWizardSpellSlotsWireValue);
      expect(seed.spell_slots).toEqual({ '1': { max: 2, current: 2 } });
    });

    it('emits no spell_slots key for a non-caster premade', () => {
      const seed = buildStarterCharacterSeed(
        { ...academyTemplates[0], class: 'Fighter' } as unknown as StarterCharacterTemplateLike,
        'academy-of-arcane-gastronomy',
      );

      expect(seed).not.toHaveProperty('spell_slots');
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  formatStarterSpellBackfillPlan,
  getTemplateSpellLists,
  parseCliArgs,
  planStarterSpellBackfill,
} from '../scripts/backfill-starter-spell-columns';

import type {
  StarterCharacterRow,
  StarterTemplateRow,
} from '../scripts/backfill-starter-spell-columns';

const BASE_STATS = {
  character_id: 'wizard-1',
  strength: 8,
  dexterity: 12,
  constitution: 12,
  intelligence: 16,
  wisdom: 12,
  charisma: 10,
};

const BASE_TEMPLATE = {
  starter_campaign_id: 'academy',
  template_key: 'the-apprentice',
  name: 'The Apprentice',
  race: 'Human',
  class: 'Wizard',
  level: 1,
  ability_scores: {
    strength: 8,
    dexterity: 12,
    constitution: 12,
    intelligence: 16,
    wisdom: 12,
    charisma: 10,
  },
};

function inputFor(
  character: Partial<StarterCharacterRow> = {},
  template = BASE_TEMPLATE,
): {
  sessions: { character_id: string; starter_campaign_id: string }[];
  characters: StarterCharacterRow[];
  stats: (typeof BASE_STATS)[];
  templates: (typeof BASE_TEMPLATE)[];
} {
  return {
    sessions: [{ character_id: 'wizard-1', starter_campaign_id: 'academy' }],
    characters: [
      {
        id: 'wizard-1',
        name: 'The Apprentice',
        class: 'Wizard',
        level: 1,
        known_spells: null,
        prepared_spells: null,
        ...character,
      },
    ],
    stats: [BASE_STATS],
    templates: [template],
  };
}

describe('backfill-starter-spell-columns', () => {
  it('uses the template relationship and tops up a Wizard add-only', () => {
    const result = planStarterSpellBackfill(
      inputFor({ known_spells: 'player-known', prepared_spells: 'player-prepared' }),
    );
    const [plan] = result.plans;

    expect(plan).toMatchObject({
      characterId: 'wizard-1',
      knownQuota: 6,
      preparedQuota: 4,
      previousKnownSpells: 'player-known',
      previousPreparedSpells: 'player-prepared',
      changed: true,
    });
    expect(plan.nextKnownSpells).toMatch(/^player-known, /);
    expect(plan.nextPreparedSpells).toMatch(/^player-prepared, /);
    expect(plan.addedKnownSpells).toHaveLength(5);
    expect(plan.addedPreparedSpells).toHaveLength(3);
    expect(formatStarterSpellBackfillPlan(plan)).toContain(
      'predicate unique known 6/6, unique prepared 4/4',
    );
  });

  it('prioritizes an authored template list before SRD fallback', () => {
    const template = {
      ...BASE_TEMPLATE,
      spells: {
        knownSpells: ['shield'],
        preparedSpells: ['shield'],
      },
    };
    const result = planStarterSpellBackfill(
      inputFor({ known_spells: null, prepared_spells: null }, template),
    );
    const [plan] = result.plans;

    expect(plan.source).toBe('template + SRD fallback');
    expect(plan.addedKnownSpells[0]).toBe('shield');
    expect(plan.addedPreparedSpells[0]).toBe('shield');
  });

  it('preserves an over-quota player-customized row and is idempotent after top-up', () => {
    const firstInput = inputFor({
      known_spells:
        'custom-one, custom-two, custom-three, custom-four, custom-five, custom-six, custom-seven',
      prepared_spells: 'prepared-one, prepared-two, prepared-three, prepared-four, prepared-five',
    });
    const first = planStarterSpellBackfill(firstInput);
    const [firstPlan] = first.plans;

    expect(firstPlan.changed).toBe(false);
    expect(firstPlan.nextKnownSpells).toBe(firstInput.characters[0].known_spells);
    expect(firstPlan.nextPreparedSpells).toBe(firstInput.characters[0].prepared_spells);

    const second = planStarterSpellBackfill(
      inputFor({
        known_spells: firstPlan.nextKnownSpells,
        prepared_spells: firstPlan.nextPreparedSpells,
      }),
    );
    expect(second.plans[0].changed).toBe(false);
    expect(second.plans[0].addedKnownSpells).toEqual([]);
    expect(second.plans[0].addedPreparedSpells).toEqual([]);
  });

  it('reads JSON-array spell columns without treating the whole JSON value as one spell', () => {
    const result = planStarterSpellBackfill(
      inputFor({ known_spells: '["alarm"]', prepared_spells: '["alarm"]' }),
    );
    const [plan] = result.plans;

    expect(plan.addedKnownSpells).toHaveLength(5);
    expect(plan.addedPreparedSpells).toHaveLength(3);
    expect(plan.nextKnownSpells).toMatch(/^alarm, /);
    expect(plan.nextKnownSpells).not.toContain('["alarm"]');
  });

  it('skips a starter-session row without a unique source template', () => {
    const result = planStarterSpellBackfill(
      inputFor(
        { known_spells: null, prepared_spells: null },
        {
          ...BASE_TEMPLATE,
          name: 'Different Name',
        },
      ),
    );

    expect(result.plans).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain('no unique source starter template');
  });

  it('reads nested and snake_case template spell lists', () => {
    expect(
      getTemplateSpellLists({
        ...BASE_TEMPLATE,
        spells: JSON.stringify({
          known_spells: ['shield'],
          preparedSpells: ['shield'],
        }) as unknown as StarterTemplateRow['spells'],
      } as unknown as StarterTemplateRow),
    ).toMatchObject({ knownSpells: ['shield'], preparedSpells: ['shield'] });
  });

  it('defaults to dry-run and gates writes behind --apply', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--apply'])).toEqual({ dryRun: false });
    expect(() => parseCliArgs(['--force'])).toThrow('Unknown option: --force');
  });
});

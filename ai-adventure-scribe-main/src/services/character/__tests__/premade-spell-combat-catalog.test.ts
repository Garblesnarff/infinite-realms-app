/**
 * #2233: every spell a premade starts with must resolve in the combat engine, or be refused with
 * a reason the player can act on. Run M4's wizard premade had Chill Touch on its sheet and the
 * engine answered "unknown spell", because the sheet and the resolver read the catalog through
 * different spellings. This walks the real seeding path for all 15 premades (3 pre-built
 * campaigns x 5) through the engine's own verdict function.
 */
import { describe, expect, it } from 'vitest';

import {
  assessPlayerCombatSpell,
  resolveCatalogSpell,
} from '../../../../server-bun/src/data/spellData';
import { buildStarterSpellSeed } from '../starter-character-seeding';

type Scores = Record<
  'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma',
  number
>;

const scores = (
  strength: number,
  dexterity: number,
  constitution: number,
  intelligence: number,
  wisdom: number,
  charisma: number,
): Scores => ({ strength, dexterity, constitution, intelligence, wisdom, charisma });

// Class and ability scores of each premade: abyssal-descent and the-eternal-feast from
// supabase/migrations/20260103_seed_starter_character_templates.sql (+ the 20260117 update), and
// academy-of-arcane-gastronomy from the fixture in starter-character-seeding.test.ts. All level 1.
const PREMADES: Array<{ campaign: string; name: string; class: string; scores: Scores }> = [
  {
    campaign: 'abyssal-descent',
    name: 'The Veteran',
    class: 'Fighter',
    scores: scores(16, 12, 14, 10, 13, 10),
  },
  {
    campaign: 'abyssal-descent',
    name: 'The Scholar',
    class: 'Wizard',
    scores: scores(8, 12, 12, 18, 14, 10),
  },
  {
    campaign: 'abyssal-descent',
    name: 'The Hunter',
    class: 'Ranger',
    scores: scores(14, 16, 14, 12, 14, 8),
  },
  {
    campaign: 'abyssal-descent',
    name: 'The Pact-Bound',
    class: 'Warlock',
    scores: scores(8, 14, 14, 12, 10, 18),
  },
  {
    campaign: 'abyssal-descent',
    name: 'The Exile',
    class: 'Druid',
    scores: scores(10, 18, 12, 12, 14, 10),
  },
  {
    campaign: 'the-eternal-feast',
    name: 'The Storyteller',
    class: 'Bard',
    scores: scores(8, 14, 12, 14, 12, 18),
  },
  {
    campaign: 'the-eternal-feast',
    name: 'The Faithful',
    class: 'Cleric',
    scores: scores(14, 10, 14, 10, 18, 12),
  },
  {
    campaign: 'the-eternal-feast',
    name: 'The Lucky One',
    class: 'Rogue',
    scores: scores(8, 16, 12, 12, 10, 16),
  },
  {
    campaign: 'the-eternal-feast',
    name: 'The Reveler',
    class: 'Barbarian',
    scores: scores(14, 14, 14, 10, 10, 16),
  },
  {
    campaign: 'the-eternal-feast',
    name: 'The Seeker',
    class: 'Ranger',
    scores: scores(10, 16, 12, 14, 16, 10),
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    name: 'The Apprentice',
    class: 'Wizard',
    scores: scores(8, 12, 12, 16, 12, 10),
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    name: 'The Kitchen Hand',
    class: 'Rogue',
    scores: scores(8, 16, 12, 12, 10, 14),
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    name: 'The Gourmand',
    class: 'Fighter',
    scores: scores(16, 12, 16, 8, 10, 10),
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    name: 'The Herbalist',
    class: 'Druid',
    scores: scores(10, 12, 12, 12, 16, 12),
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    name: 'The Sous Chef',
    class: 'Sorcerer',
    scores: scores(8, 12, 14, 10, 10, 16),
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    name: 'The Oathbound',
    class: 'Paladin',
    scores: scores(16, 10, 14, 10, 12, 14),
  },
];

function premadeSpellIds(premade: (typeof PREMADES)[number]): string[] {
  const seed = buildStarterSpellSeed({
    name: premade.name,
    class: premade.class,
    level: 1,
    ability_scores: premade.scores,
  });
  return [...new Set([...seed.cantrips, ...seed.knownSpells, ...seed.preparedSpells])];
}

describe('premade spells through the combat resolver (#2233)', () => {
  it('covers all 16 premades of the 3 pre-built campaigns', () => {
    expect(PREMADES).toHaveLength(16);
    expect(new Set(PREMADES.map((premade) => premade.campaign)).size).toBe(3);
  });

  describe.each(PREMADES)('$name ($class, $campaign)', (premade) => {
    const spellIds = premadeSpellIds(premade);

    it.each(spellIds.length ? spellIds : ['(no spells at level 1)'])(
      '%s resolves or is refused with an actionable reason',
      (spellId) => {
        if (!spellIds.length) return;
        const catalogSpell = resolveCatalogSpell(spellId);
        // The sheet's spell is the engine's spell: never "unknown", in any spelling it travels in.
        expect(catalogSpell, `${spellId} is missing from the engine catalog`).toBeDefined();
        const spell = catalogSpell!;
        expect(resolveCatalogSpell(undefined, spell.name)?.id).toBe(spell.id);
        expect(resolveCatalogSpell(spell.id.replace(/-/g, '_'))?.id).toBe(spell.id);
        expect(resolveCatalogSpell('not-a-catalog-id', spell.name)?.id).toBe(spell.id);

        const verdict = assessPlayerCombatSpell(spell.id, spell.name, spell.level || null);
        if (verdict.castable) {
          expect(verdict.spell.id).toBe(spell.id);
          return;
        }
        expect(verdict.reason).not.toBe('unknown_spell');
        expect(verdict.spell?.id).toBe(spell.id);
        expect(verdict.message).toContain(spell.name);
        // Actionable: the refusal says what to do instead, not only what went wrong.
        expect(verdict.message).toMatch(/ — (describe|say|cast)/);
      },
    );
  });

  it("resolves The Apprentice's M4 spells: Chill Touch, Acid Splash, and Burning Hands", () => {
    const apprentice = PREMADES.find((premade) => premade.name === 'The Apprentice')!;
    const spellIds = premadeSpellIds(apprentice);
    expect(spellIds).toEqual(
      expect.arrayContaining(['chill-touch', 'acid-splash', 'burning-hands']),
    );

    const chillTouch = assessPlayerCombatSpell('chill_touch', 'Chill Touch');
    expect(chillTouch).toMatchObject({ castable: true, spell: { id: 'chill-touch' } });
    const acidSplash = assessPlayerCombatSpell('acid-splash', 'Acid Splash');
    expect(acidSplash).toMatchObject({
      castable: true,
      spell: { id: 'acid-splash', saveAbility: 'dex' },
    });
    expect(acidSplash.castable && acidSplash.spell.attackType).toBeFalsy();
    expect(assessPlayerCombatSpell('burning-hands', 'Burning Hands', 1)).toMatchObject({
      castable: true,
      spell: { id: 'burning-hands', level: 1 },
    });
  });
});

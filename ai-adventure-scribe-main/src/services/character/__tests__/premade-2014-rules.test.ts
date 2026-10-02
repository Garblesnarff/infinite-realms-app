/**
 * #2483: the premades follow 2014 5e (SRD 5.1). A level 1 Ranger or Paladin has no spellcasting:
 * no slots, no spells, no spell attack or save DC on the sheet.
 *
 * The template rows are read from the seed migrations, the way the database holds them, and run
 * through the real producers: buildStarterCharacterSeed (what the seeder writes), then
 * transformCharacterData (what the sheet loads) and buildCharacterSheet (what RightSheet shows).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildStarterCharacterSeed } from '../starter-character-seeding';

import type {
  StarterCharacterCreatePayload,
  StarterCharacterTemplateLike,
} from '../starter-character-seeding';
import type { Character } from '@/types/character';
import type { CharacterStatsRow } from '@/utils/character/data-transformers';

import { lookupBackgrounds } from '@/data/backgroundOptions';
import { classes } from '@/data/classes';
import { buildCharacterSheet } from '@/features/game-session/components/game/overhaul/useOverhaulViewModel';
import { transformCharacterData } from '@/utils/character/data-transformers';
import { calculateAllCharacterStats } from '@/utils/character-calculations';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');
const SKILL_FIX_MIGRATION = '20261001_fix_premade_skill_proficiencies_2014.sql';
const JSON_COLUMNS = new Set(['ability_scores', 'personality', 'skills', 'languages', 'equipment']);

type TemplateRow = StarterCharacterTemplateLike & {
  starter_campaign_id: string;
  template_key: string;
  skills: string[];
};

/** Items of a SQL value list, split on top-level commas; ends at the closing paren or the FROM. */
function readSqlList(
  sql: string,
  start: number,
  endsAtFrom: boolean,
): { items: string[]; end: number } {
  const items: string[] = [];
  let itemStart = start;
  let inString = false;
  let depth = 0;
  for (let i = start; i < sql.length; i += 1) {
    const character = sql[i];
    if (character === "'") {
      if (inString && sql[i + 1] === "'") i += 1;
      else inString = !inString;
    } else if (inString) {
      continue;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')' && depth > 0) {
      depth -= 1;
    } else if (
      (character === ')' && !endsAtFrom) ||
      (endsAtFrom && depth === 0 && sql.startsWith('\nFROM', i))
    ) {
      items.push(sql.slice(itemStart, i).trim());
      return { items, end: i };
    } else if (character === ',' && depth === 0) {
      items.push(sql.slice(itemStart, i).trim());
      itemStart = i + 1;
    }
  }
  throw new Error('unterminated SQL value list');
}

function decodeSqlValue(value: string, column: string): unknown {
  if (value === 'NULL') return null;
  if (/^\d+$/.test(value)) return Number(value);
  const text = value.replace(/^'([\s\S]*)'$/, '$1').replace(/''/g, "'");
  return JSON_COLUMNS.has(column) ? JSON.parse(text) : text;
}

/** Every row the seed migrations insert, in file order (VALUES and INSERT ... SELECT forms). */
function readSeededTemplates(): TemplateRow[] {
  const rows: TemplateRow[] = [];
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /seed.*character_templates.*\.sql$/.test(name))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const insert =
      /INSERT\s+INTO\s+public\.starter_character_templates\s*\(([^)]*)\)\s*(VALUES\s*\(|SELECT\s)/g;
    let match: RegExpExecArray | null;
    while ((match = insert.exec(sql))) {
      const columns = match[1].split(',').map((column) => column.trim());
      const isSelect = match[2].startsWith('SELECT');
      const { items, end } = readSqlList(sql, insert.lastIndex, isSelect);
      const row: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        row[column] = decodeSqlValue(items[index], column);
      });
      if (isSelect) {
        // INSERT ... SELECT id ... FROM starter_campaigns WHERE id = '<campaign>'
        row.starter_campaign_id = /WHERE id = '([^']+)'/.exec(sql.slice(end))?.[1];
      }
      rows.push(row as unknown as TemplateRow);
      insert.lastIndex = end;
    }
  }
  return rows;
}

/** The skill corrections of the #2483 migration, applied as its class guard applies them. */
function applySkillFixMigration(rows: TemplateRow[]): { rows: TemplateRow[]; fixed: string[] } {
  const sql = readFileSync(join(MIGRATIONS, SKILL_FIX_MIGRATION), 'utf8');
  const update =
    /SET skills = '([^']*)'\s+WHERE starter_campaign_id = '([^']*)'\s+AND template_key = '([^']*)'\s+AND class = '([^']*)'/g;
  const fixes = [...sql.matchAll(update)];
  const fixed: string[] = [];
  const result = rows.map((row) => {
    const fix = fixes.find(
      ([, , campaign, key, className]) =>
        campaign === row.starter_campaign_id && key === row.template_key && className === row.class,
    );
    if (!fix) return row;
    fixed.push(row.template_key);
    return { ...row, skills: JSON.parse(fix[1]) as string[] };
  });
  return { rows: result, fixed };
}

const seeded = readSeededTemplates();
const { rows: premades, fixed: fixedKeys } = applySkillFixMigration(seeded);

const premade = (key: string): TemplateRow => {
  const row = premades.find((candidate) => candidate.template_key === key);
  if (!row) throw new Error(`no seeded premade ${key}`);
  return row;
};

const premadeSeed = (key: string): TemplateRow => {
  const row = seeded.find((candidate) => candidate.template_key === key);
  if (!row) throw new Error(`no seeded premade ${key}`);
  return row;
};

/** The sheet as the game page builds it for a freshly seeded premade. */
function sheetFor(row: TemplateRow): {
  seed: StarterCharacterCreatePayload;
  character: Character;
  sheet: ReturnType<typeof buildCharacterSheet>;
} {
  const seed = buildStarterCharacterSeed(row, row.starter_campaign_id);
  const character = transformCharacterData(
    {
      id: 'character-2483',
      user_id: 'user-2483',
      name: seed.name,
      race: seed.race as string,
      subrace: seed.subrace as string | null,
      class: seed.class as string,
      level: seed.level as number,
      background: seed.background as string | null,
      skill_proficiencies: seed.skill_proficiencies as string,
      cantrips: seed.cantrips as string,
      known_spells: seed.known_spells as string,
      prepared_spells: seed.prepared_spells as string,
    },
    seed.stats as CharacterStatsRow,
    [],
  );
  return { seed, character, sheet: buildCharacterSheet(character) };
}

describe('premade starter templates follow 2014 rules (#2483)', () => {
  it('reads all 30 seeded premades', () => {
    expect(seeded).toHaveLength(30);
  });

  describe('level 1 Ranger', () => {
    const rangers = premades.filter((row) => row.class === 'Ranger');

    it('covers The Hunter and the other level 1 Ranger premades', () => {
      expect(rangers.map((row) => row.template_key).sort()).toEqual([
        'the-deserter',
        'the-exile',
        'the-hunter',
        'the-seeker',
        'the-tracker',
      ]);
      expect(rangers.every((row) => row.level === 1)).toBe(true);
    });

    it.each(rangers.map((row) => [row.template_key, row] as const))(
      '%s is seeded with no slots and no spells',
      (_key, row) => {
        const { seed } = sheetFor(row);

        expect(seed).not.toHaveProperty('spell_slots');
        expect(seed.cantrips).toBe('');
        expect(seed.known_spells).toBe('');
        expect(seed.prepared_spells).toBe('');
      },
    );

    it.each(rangers.map((row) => [row.template_key, row] as const))(
      '%s sheet shows no spellcasting, no slots, no attack or DC',
      (_key, row) => {
        const { character, sheet } = sheetFor(row);
        const stats = calculateAllCharacterStats(character);

        expect(stats.spellcastingAbility).toBeUndefined();
        expect(stats.spellSlots).toBeUndefined();
        expect(stats.spellAttackBonus).toBeUndefined();
        expect(stats.spellSaveDC).toBeUndefined();
        expect(sheet.spellcasting).toBeNull();
        expect(sheet.spells).toEqual({ cantrips: [], known: [], prepared: [] });
      },
    );
  });

  describe('a caster premade is unchanged', () => {
    it('The Scholar (Wizard) keeps its slots, spells, attack and save DC', () => {
      const row = premade('the-scholar');
      const { seed, sheet } = sheetFor(row);

      expect(seed.spell_slots).toEqual({ '1': { max: 2, current: 2 } });
      expect(seed.cantrips).toBe('acid-splash, chill-touch, dancing-lights');
      expect(seed.known_spells).toBe(
        'alarm, burning-hands, charm-person, color-spray, comprehend-languages, detect-magic',
      );
      expect(seed.prepared_spells).toBe(
        'alarm, burning-hands, charm-person, color-spray, comprehend-languages',
      );
      expect(sheet.spellcasting).toEqual({
        ability: 'INT',
        spellAttackBonus: 6,
        spellSaveDC: 14,
        canPrepare: true,
        slots: [{ level: 1, current: 2, max: 2 }],
      });
    });

    it('the skill migration changes nothing but skill_proficiencies on the rows it touches', () => {
      // The Storyteller (Bard) is the one caster among them; its spell seed must not move.
      for (const key of fixedKeys) {
        const original = premadeSeed(key);
        const before = buildStarterCharacterSeed(original, original.starter_campaign_id);
        const after = buildStarterCharacterSeed(premade(key), original.starter_campaign_id);

        expect({ ...after, skill_proficiencies: null }).toEqual({
          ...before,
          skill_proficiencies: null,
        });
        expect(after.skill_proficiencies).not.toEqual(before.skill_proficiencies);
      }
    });
  });

  describe('skill proficiencies', () => {
    const normalize = (skill: string) => skill.toLowerCase().replace(/\s+/g, '_');
    // Race grants the client tables do not carry (2014 PHB, MOoT): Elf Keen Senses, Half-Orc
    // Menacing, Satyr Reveler. Half-Elf Skill Versatility is two free picks.
    const RACE_SKILLS: Record<string, string[]> = {
      Elf: ['perception'],
      'Half-Orc': ['intimidation'],
      Satyr: ['performance', 'persuasion'],
    };

    it('the migration corrects exactly the seven rows the audit found', () => {
      expect([...fixedKeys].sort()).toEqual([
        'the-cracksman',
        'the-exile',
        'the-furnace-born',
        'the-rigger',
        'the-seeker',
        'the-storyteller',
        'the-tracker',
      ]);
    });

    // The Pact-Bound's Haunted One lets the player choose two of four skills, which the client
    // table (Investigation, Survival) does not model; it is checked by hand in the audit.
    it.each(
      premades
        .filter((row) => row.background !== 'Haunted One')
        .map((row) => [row.template_key, row] as const),
    )('%s has its background skills and no more class skills than 2014 allows', (_key, row) => {
      const skills = row.skills.map(normalize);
      const background = lookupBackgrounds.find((entry) => entry.name === row.background);
      const characterClass = classes.find((entry) => entry.name === row.class);
      if (!characterClass) throw new Error(`no class ${row.class}`);
      const backgroundSkills = (background?.skillProficiencies ?? []).map(normalize);
      const raceSkills = RACE_SKILLS[row.race] ?? [];
      const halfElfPicks = row.race === 'Half-Elf' ? 2 : 0;
      const picks = skills.filter(
        (skill) => !backgroundSkills.includes(skill) && !raceSkills.includes(skill),
      );

      expect(backgroundSkills.length).toBe(2);
      expect(skills).toEqual(expect.arrayContaining(backgroundSkills));
      expect(picks.length).toBeLessThanOrEqual(characterClass.numSkillChoices + halfElfPicks);
      const classSkills = characterClass.skillChoices.map(normalize);
      if (!halfElfPicks && !classSkills.includes('any')) {
        expect(classSkills).toEqual(expect.arrayContaining(picks));
      }
    });
  });
});

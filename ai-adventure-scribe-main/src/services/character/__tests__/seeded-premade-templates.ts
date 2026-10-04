/**
 * The premade template rows as the database holds them, read from the seed migrations.
 *
 * The seed inserts are parsed from the SQL (VALUES and INSERT ... SELECT forms), then the
 * 20260117 Eternal Feast equipment updates are applied, because those two rows (The Reveler,
 * The Seeker) are not what the January seed inserted. The Academy of Arcane Gastronomy rows
 * are copied from the production template shape because that campaign was seeded outside this
 * repository; its new equipment update is then applied like the other migration updates.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');
const EQUIPMENT_UPDATE_MIGRATIONS = [
  '20260117_update_eternal_feast_characters.sql',
  '20261003_update_academy_starter_character_templates_equipment.sql',
];
const JSON_COLUMNS = new Set(['ability_scores', 'personality', 'skills', 'languages', 'equipment']);

const ACADEMY_TEMPLATES: SeededPremadeTemplate[] = [
  {
    starter_campaign_id: 'academy-of-arcane-gastronomy',
    template_key: 'the-apprentice',
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
    starter_campaign_id: 'academy-of-arcane-gastronomy',
    template_key: 'the-kitchen-hand',
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
    starter_campaign_id: 'academy-of-arcane-gastronomy',
    template_key: 'the-gourmand',
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
    starter_campaign_id: 'academy-of-arcane-gastronomy',
    template_key: 'the-herbalist',
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
    starter_campaign_id: 'academy-of-arcane-gastronomy',
    template_key: 'the-sous-chef',
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
];

export type SeededPremadeTemplate = {
  name: string;
  race: string;
  subrace?: string | null;
  class: string;
  background?: string | null;
  level?: number;
  tagline?: string | null;
  description?: string | null;
  adaptedBackstory?: string | null;
  adapted_backstory?: string | null;
  languages?: string[];
  abilityScores?: Record<string, number>;
  ability_scores?: Record<string, number>;
  cantrips?: string[] | null;
  knownSpells?: string[] | null;
  preparedSpells?: string[] | null;
  known_spells?: string[] | null;
  prepared_spells?: string[] | null;
  spells?: {
    cantrips?: string[];
    knownSpells?: string[];
    preparedSpells?: string[];
  };
  starter_campaign_id: string;
  template_key: string;
  skills: string[];
  equipment: string[];
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

function readTemplateInserts(files: string[]): SeededPremadeTemplate[] {
  const rows: SeededPremadeTemplate[] = [];
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
      rows.push(row as unknown as SeededPremadeTemplate);
      insert.lastIndex = end;
    }
  }
  return rows;
}

/** `SET ... equipment = '[...]' ... WHERE starter_campaign_id = 'x' AND template_key = 'y'`. */
function applyEquipmentUpdates(rows: SeededPremadeTemplate[]): SeededPremadeTemplate[] {
  return EQUIPMENT_UPDATE_MIGRATIONS.reduce((currentRows, migration) => {
    const sql = readFileSync(join(MIGRATIONS, migration), 'utf8');
    const update =
      /equipment = '((?:[^']|'')*)'\s*(?:,|(?=WHERE))[\s\S]*?WHERE starter_campaign_id = '([^']*)'\s+AND template_key = '([^']*)'/g;
    const updates = [...sql.matchAll(update)];
    return currentRows.map((row) => {
      const found = updates.find(
        ([, , campaign, key]) => campaign === row.starter_campaign_id && key === row.template_key,
      );
      return found
        ? { ...row, equipment: JSON.parse(found[1].replace(/''/g, "'")) as string[] }
        : row;
    });
  }, rows);
}

/** Every seeded premade, in migration order, with the equipment updates applied. */
export function readSeededPremadeTemplates(): SeededPremadeTemplate[] {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /seed.*character_templates.*\.sql$/.test(name))
    .sort();
  return applyEquipmentUpdates([...readTemplateInserts(files), ...ACADEMY_TEMPLATES]);
}

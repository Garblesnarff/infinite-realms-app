/**
 * The premade template rows as the database holds them, read from the seed migrations.
 *
 * The seed inserts are parsed from the SQL (VALUES and INSERT ... SELECT forms), then the
 * 20260117 Eternal Feast equipment updates are applied, because those two rows (The Reveler,
 * The Seeker) are not what the January seed inserted. The Academy of Arcane Gastronomy rows
 * are copied from the production template shape because that campaign was seeded outside this
 * repository; its new equipment update is then applied like the other migration updates.
 * The 20261117 SRD fix migration is replayed after the equipment updates.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');
const EQUIPMENT_UPDATE_MIGRATIONS = [
  '20260117_update_eternal_feast_characters.sql',
  '20261003_update_academy_starter_character_templates_equipment.sql',
];
const SRD_FIX_MIGRATION = '20261117_fix_premade_srd_subrace_and_origin_2014.sql';
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
  subclass?: string | null;
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

/** Parse and replay the UPDATE statements in the #52 SRD fix migration. */
function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "'") {
      if (inString && input[i + 1] === "'") {
        i += 1;
      } else {
        inString = !inString;
      }
    } else if (!inString) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(input.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  const tail = input.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

interface SrdFixStatement {
  campaign: string;
  key: string;
  raceGuard?: string;
  classGuard?: string;
  subraceNullGuard: boolean;
  subclassNullGuard: boolean;
  abilityKeyGuard?: string;
  subraceSet?: string;
  subclassSet?: string;
  abilityIncrement?: { key: string; n: number };
}

function parseSrdFixStatement(setClause: string, whereClause: string): SrdFixStatement {
  const assignments = splitTopLevelCommas(setClause);
  const stmt: SrdFixStatement = {
    campaign: '',
    key: '',
    subraceNullGuard: false,
    subclassNullGuard: false,
  };
  for (const assignment of assignments) {
    let m = /^subrace\s*=\s*'([^']*)'$/i.exec(assignment);
    if (m) {
      if (stmt.subraceSet !== undefined) throw new Error('duplicate subrace assignment');
      stmt.subraceSet = m[1];
      continue;
    }
    m = /^subclass\s*=\s*'([^']*)'$/i.exec(assignment);
    if (m) {
      if (stmt.subclassSet !== undefined) throw new Error('duplicate subclass assignment');
      stmt.subclassSet = m[1];
      continue;
    }
    m =
      /^ability_scores\s*=\s*ability_scores\s*\|\|\s*jsonb_build_object\(\s*'([^']+)'\s*,\s*\(ability_scores->>'([^']+)'\)::int\s*\+\s*(\d+)\s*\)$/i.exec(
        assignment,
      );
    if (m) {
      if (m[1] !== m[2]) throw new Error('mismatched ability key in jsonb_build_object');
      if (stmt.abilityIncrement) throw new Error('duplicate ability_scores assignment');
      stmt.abilityIncrement = { key: m[1], n: Number(m[3]) };
      continue;
    }
    throw new Error(`unrecognized SET assignment in #52 migration: ${assignment}`);
  }

  const campaignMatch = /starter_campaign_id\s*=\s*'([^']*)'/i.exec(whereClause);
  const keyMatch = /template_key\s*=\s*'([^']*)'/i.exec(whereClause);
  if (!campaignMatch || !keyMatch) {
    throw new Error('missing starter_campaign_id/template_key in #52 migration WHERE');
  }
  stmt.campaign = campaignMatch[1];
  stmt.key = keyMatch[1];

  const conditions = whereClause
    .split(/\s+AND\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
  for (const condition of conditions) {
    if (/^starter_campaign_id\s*=\s*'[^']*'$/i.test(condition)) continue;
    if (/^template_key\s*=\s*'[^']*'$/i.test(condition)) continue;
    let m = /^race\s*=\s*'([^']*)'$/i.exec(condition);
    if (m) {
      stmt.raceGuard = m[1];
      continue;
    }
    m = /^class\s*=\s*'([^']*)'$/i.exec(condition);
    if (m) {
      stmt.classGuard = m[1];
      continue;
    }
    if (/^subrace\s+IS\s+NULL$/i.test(condition)) {
      stmt.subraceNullGuard = true;
      continue;
    }
    if (/^subclass\s+IS\s+NULL$/i.test(condition)) {
      stmt.subclassNullGuard = true;
      continue;
    }
    m = /^ability_scores\s*\?\s*'([^']*)'$/i.exec(condition);
    if (m) {
      stmt.abilityKeyGuard = m[1];
      continue;
    }
    throw new Error(`unrecognized WHERE condition in #52 migration: ${condition}`);
  }

  return stmt;
}

function applySrdFixUpdates(rows: SeededPremadeTemplate[]): SeededPremadeTemplate[] {
  const sql = readFileSync(join(MIGRATIONS, SRD_FIX_MIGRATION), 'utf8');
  const updateRegex =
    /UPDATE\s+public\.starter_character_templates\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?);/gi;
  const matches = [...sql.matchAll(updateRegex)];
  const updateOccurrences = [...sql.matchAll(/\bUPDATE\s+public\.starter_character_templates\b/gi)]
    .length;
  if (matches.length !== updateOccurrences) {
    throw new Error('could not parse all UPDATE statements in #52 migration');
  }
  const statements = matches.map((match) => parseSrdFixStatement(match[1], match[2]));

  let current = rows;
  for (const stmt of statements) {
    current = current.map((row) => {
      if (row.starter_campaign_id !== stmt.campaign || row.template_key !== stmt.key) return row;
      if (stmt.raceGuard !== undefined && row.race !== stmt.raceGuard) return row;
      if (stmt.classGuard !== undefined && row.class !== stmt.classGuard) return row;
      if (stmt.subraceNullGuard && (row.subrace ?? null) !== null) return row;
      if (stmt.subclassNullGuard && (row.subclass ?? null) !== null) return row;
      const abilityScoresField =
        row.ability_scores !== undefined ? 'ability_scores' : 'abilityScores';
      const currentScores = (row[abilityScoresField] as Record<string, number> | undefined) ?? {};
      if (stmt.abilityKeyGuard !== undefined && !(stmt.abilityKeyGuard in currentScores))
        return row;

      const next: SeededPremadeTemplate = { ...row };
      if (stmt.subraceSet !== undefined) next.subrace = stmt.subraceSet;
      if (stmt.subclassSet !== undefined) next.subclass = stmt.subclassSet;
      if (stmt.abilityIncrement) {
        const { key, n } = stmt.abilityIncrement;
        const base = (next[abilityScoresField] as Record<string, number> | undefined) ?? {};
        next[abilityScoresField] = { ...base, [key]: (base[key] ?? 0) + n };
      }
      return next;
    });
  }
  return current;
}

/** Every seeded premade, in migration order, with the equipment updates applied. */
export function readSeededPremadeTemplates(): SeededPremadeTemplate[] {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /seed.*character_templates.*\.sql$/.test(name))
    .sort();
  return applySrdFixUpdates(
    applyEquipmentUpdates([...readTemplateInserts(files), ...ACADEMY_TEMPLATES]),
  );
}

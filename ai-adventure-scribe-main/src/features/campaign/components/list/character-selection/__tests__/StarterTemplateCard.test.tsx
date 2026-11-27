import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StarterTemplateCard } from '../StarterTemplateCard';

import type { StarterTemplate } from '@/features/campaign/hooks/use-character-selection';

import { transformAbilityScores } from '@/utils/character/data-transformers';

const getModifier = (score?: number): string => {
  if (!score) return '+0';
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

const baseTemplate: StarterTemplate = {
  id: 'tpl-1',
  starter_campaign_id: 'abyssal-descent',
  template_key: 'the-scholar',
  name: 'The Scholar',
  tagline: null,
  race: 'Elf',
  subrace: 'Wood Elf',
  class: 'Wizard',
  background: 'Sage',
  level: 1,
  ability_scores: {
    strength: 8,
    dexterity: 14,
    constitution: 12,
    intelligence: 16,
    wisdom: 12,
    charisma: 10,
  },
  personality: {},
  skills: [],
  languages: [],
  equipment: [],
  adapted_backstory: null,
  campaign_hook: null,
  portrait_url: null,
  card_image_url: null,
  portrait_prompt: null,
  display_order: 1,
};

const renderCard = (template: StarterTemplate): void => {
  render(
    <StarterTemplateCard
      template={template}
      isCreating={false}
      onSelect={vi.fn()}
      getModifier={getModifier}
    />,
  );
};

describe('StarterTemplateCard', () => {
  it('shows the stored template scores, the same scores the sheet shows (#153)', () => {
    // The sheet reads the character row's stored scores verbatim
    // (useEffectiveAbilityScores returns them unchanged — racial bonuses are
    // applied once, at creation, never at display), and starter seeding stores
    // the template row's scores verbatim, so the preview shows the template
    // scores directly. Elf/Wood Elf would add DEX +2 / WIS +1 if the card
    // applied racial bonuses — it must not.
    renderCard(baseTemplate);

    expect(screen.getByLabelText('Dexterity modifier: +2')).toBeInTheDocument(); // 14 stored
    expect(screen.getByLabelText('Wisdom modifier: +1')).toBeInTheDocument(); // 12 stored
    expect(screen.getByLabelText('Intelligence modifier: +3')).toBeInTheDocument(); // 16 stored
    expect(screen.getByLabelText('Strength modifier: -1')).toBeInTheDocument(); // 8 stored
    // The bonus-added score must NOT be shown (DEX 14 + 2 racial = +3).
    expect(screen.queryByLabelText('Dexterity modifier: +3')).not.toBeInTheDocument();
  });

  it('shows the stored scores when the template has no subrace', () => {
    renderCard({ ...baseTemplate, subrace: null });

    expect(screen.getByLabelText('Dexterity modifier: +2')).toBeInTheDocument(); // 14 stored
    expect(screen.getByLabelText('Wisdom modifier: +1')).toBeInTheDocument(); // 12 stored
  });

  it('shows the stored scores when the race is unknown', () => {
    renderCard({ ...baseTemplate, race: 'Mystery Folk', subrace: null });

    expect(screen.getByLabelText('Dexterity modifier: +2')).toBeInTheDocument(); // 14 stored
    expect(screen.getByLabelText('Intelligence modifier: +3')).toBeInTheDocument();
  });

  it('matches the sheet for the real Scholar premade from run D5 (#153)', () => {
    // Values copied from the abyssal-descent seed: Human, no subrace, so no
    // racial bonuses — the preview must show the base scores, exactly what the
    // sheet resolves (INT 18 -> +4, WIS 14 -> +2).
    renderCard({
      ...baseTemplate,
      name: 'The Scholar',
      template_key: 'the-scholar',
      race: 'Human',
      subrace: null,
      class: 'Wizard',
      ability_scores: {
        strength: 8,
        dexterity: 12,
        constitution: 12,
        intelligence: 18,
        wisdom: 14,
        charisma: 10,
      },
    });

    expect(screen.getByLabelText('Intelligence modifier: +4')).toBeInTheDocument();
    expect(screen.getByLabelText('Wisdom modifier: +2')).toBeInTheDocument();
    expect(screen.getByLabelText('Strength modifier: -1')).toBeInTheDocument();
  });

  it('shows the stored Charisma for the Half-Elf Lovesick, not the bonus-added score (#153)', () => {
    // The Lovesick template (#222) is a Half-Elf: +2 Charisma, no subrace.
    // The sheet shows the stored CHA 16 (+3); the card must show the same,
    // not the 18 (+4) the old bonus-adding preview showed.
    renderCard({
      ...baseTemplate,
      name: 'The Lovesick',
      template_key: 'the-lovesick',
      race: 'Half-Elf',
      subrace: null,
      class: 'Sorcerer',
      ability_scores: {
        strength: 8,
        dexterity: 14,
        constitution: 14,
        intelligence: 12,
        wisdom: 10,
        charisma: 16,
      },
    });

    expect(screen.getByLabelText('Charisma modifier: +3')).toBeInTheDocument(); // 16 stored
    expect(screen.getByLabelText('Dexterity modifier: +2')).toBeInTheDocument(); // 14 stored
    expect(screen.queryByLabelText('Charisma modifier: +4')).not.toBeInTheDocument();
  });
});

// #153: the seeded premades are the source of truth — parse the seed SQL
// files directly instead of copying their rows into this file, so a seed
// change is covered without a fixture update. Both INSERT forms are in use:
// plain VALUES (20260103) and INSERT ... SELECT FROM starter_campaigns (#222).
// Resolved from the working directory: vitest runs from the app dir
// (ai-adventure-scribe-main), which holds supabase/. (import.meta.url is not
// a file:// URL under vitest — fileURLToPath throws "The URL must be of
// scheme file" — so it cannot anchor this path.)
const SEED_MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase', 'migrations');

type SeededTemplateRow = {
  templateKey: string;
  name: string;
  race: string;
  subrace: string | null;
  className: string;
  campaignId: string;
  scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
};

/** Split on commas that are not inside a single-quoted SQL literal ('' escapes a quote). */
function splitTopLevelValues(text: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          current += "'";
          i += 1;
          continue;
        }
        inQuotes = false;
      }
      current += ch;
      continue;
    }
    if (ch === "'") {
      inQuotes = true;
      current += ch;
      continue;
    }
    if (ch === ',') {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current.trim());
  return values;
}

function unquoteSql(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.toUpperCase() === 'NULL') return null;
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/** Index of the ')' matching the '(' at `openIndex`, honouring SQL quotes. */
function matchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let inQuotes = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i += 1;
          continue;
        }
        inQuotes = false;
      }
      continue;
    }
    if (ch === "'") {
      inQuotes = true;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseSeedSql(sql: string): SeededTemplateRow[] {
  const rows: SeededTemplateRow[] = [];
  for (const block of sql.split('INSERT INTO public.starter_character_templates (').slice(1)) {
    const columnsEnd = block.indexOf(')');
    const columns = block
      .slice(0, columnsEnd)
      .split(',')
      .map((column) => column.trim());
    const rest = block.slice(columnsEnd + 1).trimStart();
    let values: string[];
    let campaignId: string | null = null;
    if (rest.startsWith('VALUES')) {
      const open = rest.indexOf('(');
      const close = matchingParen(rest, open);
      values = splitTopLevelValues(rest.slice(open + 1, close));
      if (
        rest
          .slice(close + 1)
          .trimStart()
          .startsWith(',')
      ) {
        throw new Error('Multi-row VALUES in a seed INSERT is not supported');
      }
    } else if (rest.startsWith('SELECT')) {
      const fromMatch = /\nFROM\s/.exec(rest);
      if (!fromMatch) throw new Error('Seed INSERT ... SELECT without FROM');
      values = splitTopLevelValues(rest.slice('SELECT'.length, fromMatch.index));
      const whereMatch = /WHERE id = '([^']+)'/.exec(rest);
      campaignId = whereMatch ? whereMatch[1] : null;
    } else {
      throw new Error(`Unexpected seed INSERT form: ${rest.slice(0, 40)}`);
    }
    const byColumn = new Map(columns.map((column, i) => [column, values[i] ?? '']));
    const key = unquoteSql(byColumn.get('template_key') ?? '');
    const scoresRaw = unquoteSql(byColumn.get('ability_scores') ?? '');
    if (!key || !scoresRaw) {
      throw new Error('Seed row without template_key or ability_scores');
    }
    const scores = JSON.parse(scoresRaw) as SeededTemplateRow['scores'];
    for (const ability of [
      'strength',
      'dexterity',
      'constitution',
      'intelligence',
      'wisdom',
      'charisma',
    ] as const) {
      if (!Number.isFinite(scores[ability])) {
        throw new Error(`Seed row ${key} has no finite ${ability} score`);
      }
    }
    rows.push({
      templateKey: key,
      name: unquoteSql(byColumn.get('name') ?? '') ?? key,
      race: unquoteSql(byColumn.get('race') ?? '') ?? '',
      // A missing subrace column (most 20260103 rows) means NULL, not ''.
      subrace: byColumn.has('subrace') ? unquoteSql(byColumn.get('subrace') ?? '') : null,
      className: unquoteSql(byColumn.get('class') ?? '') ?? '',
      campaignId: campaignId ?? unquoteSql(byColumn.get('starter_campaign_id') ?? '') ?? '',
      scores,
    });
  }
  return rows;
}

// Every .sql file in the dir is parsed, not just the seed-named ones: a
// reset/upsert file such as 20261002_reset_the_exile_template_to_ranger.sql
// also INSERTs into the table, and a later file wins for the same
// (starter_campaign_id, template_key) — the ON CONFLICT upsert order.
const ALL_SEEDED_ROWS: SeededTemplateRow[] = readdirSync(SEED_MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .flatMap((file) => parseSeedSql(readFileSync(path.join(SEED_MIGRATIONS_DIR, file), 'utf8')));
const SEEDED_TEMPLATES: SeededTemplateRow[] = ALL_SEEDED_ROWS.reduce<SeededTemplateRow[]>(
  (unique, row) => {
    const at = unique.findIndex(
      (other) => other.campaignId === row.campaignId && other.templateKey === row.templateKey,
    );
    if (at >= 0) unique[at] = row;
    else unique.push(row);
    return unique;
  },
  [],
);

describe('seeded premade parity (#153)', () => {
  it('covers every seeded template row', () => {
    // 37 INSERTs at authoring (10 + 5 + 5 + 5 + 5 + 1 + 5 + 1 across 8 files),
    // collapsing to 36 unique templates: the 20261002 reset re-upserts the
    // Exile with the same scores. Update these counts when a template is
    // added or removed — the it.each below then covers the new set, and a
    // silently empty parse fails here instead of passing with zero cases.
    expect(ALL_SEEDED_ROWS).toHaveLength(37);
    expect(SEEDED_TEMPLATES).toHaveLength(36);
  });

  it.each(SEEDED_TEMPLATES)(
    'preview matches the sheet for $name ($templateKey, $campaignId)',
    (row) => {
      // The sheet side: the real transformer over the stored scores — what the
      // sheet shows for a character seeded from this template. The card side:
      // the rendered modifiers. The two must agree on all six scores.
      const sheetScores = transformAbilityScores(row.scores);
      if (!sheetScores) throw new Error(`No sheet scores for ${row.templateKey}`);
      renderCard({
        ...baseTemplate,
        id: `seed-${row.templateKey}`,
        starter_campaign_id: row.campaignId,
        template_key: row.templateKey,
        name: row.name,
        race: row.race,
        subrace: row.subrace,
        class: row.className,
        ability_scores: row.scores,
      });
      const labels = [
        ['Strength', 'strength'],
        ['Dexterity', 'dexterity'],
        ['Constitution', 'constitution'],
        ['Intelligence', 'intelligence'],
        ['Wisdom', 'wisdom'],
        ['Charisma', 'charisma'],
      ] as const;
      for (const [label, ability] of labels) {
        expect(
          screen.getByLabelText(`${label} modifier: ${getModifier(sheetScores[ability].score)}`),
        ).toBeInTheDocument();
      }
    },
  );
});

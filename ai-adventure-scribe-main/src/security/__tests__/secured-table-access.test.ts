import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(process.cwd(), 'src');
const SECURED_TABLES = [
  'game_sessions',
  'quests',
  'campaign_characters',
  'campaigns',
  'characters',
  'character_stats',
  'starter_character_templates',
  'combat_encounters',
  'combat_participants',
  'combat_participant_status',
  'combat_participant_conditions',
  'combat_damage_log',
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx|md)$/.test(name) && !/\.test\.|\.spec\./.test(name) ? [path] : [];
  });
}

describe('secured frontend table access', () => {
  it.each(SECURED_TABLES)('has no direct Supabase .from(%s) calls in src', (table) => {
    const pattern = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`);
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });

  it.each(SECURED_TABLES)('has no embedded Supabase relation select for %s in src', (table) => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        const selects = source.matchAll(/\.select\(\s*([`'"])([\s\S]*?)\1\s*\)/g);
        return Array.from(selects).some((match) => new RegExp(`\\b${table}\\s*\\(`).test(match[2]));
      })
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

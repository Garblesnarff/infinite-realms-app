import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The generated Database types must match the applied schema, not a remembered one.
 * #1859: this file declared character_equipment.description and the query that trusted
 * it killed every character load.
 */
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../database.ts'),
  'utf8',
);

const equipmentRow = source.slice(
  source.indexOf('character_equipment:'),
  source.indexOf('Relationships:', source.indexOf('character_equipment:')),
);

describe('generated supabase database types', () => {
  it('does not claim a description column on character_equipment', () => {
    expect(equipmentRow).not.toMatch(/^\s*description:/m);
  });

  it('includes the live magic-item columns on character_equipment', () => {
    expect(equipmentRow).toMatch(/is_magic:/);
    expect(equipmentRow).toMatch(/magic_effects:/);
    expect(equipmentRow).toMatch(/requires_attunement:/);
  });

  it('includes C0.5 vitals on characters', () => {
    expect(source).toMatch(/is_conscious:/);
    expect(source).toMatch(/death_saves_successes:/);
    expect(source).toMatch(/vital_state:/);
  });
});

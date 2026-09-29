/**
 * #2283: calculateImportance must be importable by a Bun tool with no app alias.
 *
 * The client module is imported by relative path only. Loading it is not enough proof: run from
 * here, Bun resolves `@/` through the client tsconfig's paths, so an alias import would still
 * load. A tool elsewhere (tools/jev-pilot) has no such paths, hence the source check below.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'bun:test';

import { calculateImportance } from '../../../../src/utils/memory/importance-schedule';

describe('importance-schedule (#2283)', () => {
  it('scores on the live 1–10 schedule', () => {
    expect(calculateImportance({ content: 'test', type: 'unknown' })).toBe(1);
    expect(calculateImportance({ content: 'test', type: 'plot' })).toBe(3);
    expect(calculateImportance({ content: 'test', type: 'task_result' })).toBe(5);
    expect(
      calculateImportance({
        content: 'A quest of danger with Elminster and Drizzt',
        type: 'plot',
        category: 'player_action',
        ageInHours: 0.5,
        priority: 'high',
      }),
    ).toBe(10);
  });

  it('has no @/ imports and no Memory type', () => {
    const path = fileURLToPath(
      new URL('../../../../src/utils/memory/importance-schedule.ts', import.meta.url),
    );
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/from\s+['"]@\//);
    expect(source).not.toMatch(/\bMemory\b/);
  });
});

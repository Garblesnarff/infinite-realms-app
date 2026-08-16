/**
 * Issue #1827: `characterSchema` accepts `tool_proficiencies` and
 * `saving_throw_proficiencies` on create and update, and both columns exist on
 * `characters`, but `mapCharacterToApi` never returned either one. No client
 * could read back a character's saving-throw proficiencies, so the sheet had no
 * way to put a proficiency bonus on a save.
 *
 * This pins the round-trip: every proficiency column the write path accepts is
 * a column the read path returns.
 */

import { describe, expect, it, mock } from 'bun:test';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-client' } }));
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: null, error: 'Unauthorized' }),
}));
mock.module('../../../../../db/client', () => ({ db: {} }));

const { mapCharacterToApi } = await import('../characters.js');

const monk = {
  id: '274de914-ad42-49fa-b038-8e458cf9980a',
  name: 'Claude',
  race: 'Forest Giant',
  class: 'Monk',
  level: 1,
  background: 'Sage',
  skillProficiencies: 'Arcana,History,Acrobatics,Athletics',
  expertiseProficiencies: null,
  toolProficiencies: 'Flute',
  savingThrowProficiencies: 'strength,dexterity',
  languages: ['Common', 'Giant'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('mapCharacterToApi proficiency round-trip (#1827)', () => {
  it('returns every proficiency column the write path accepts', () => {
    const api = mapCharacterToApi(monk)!;

    expect(api.skill_proficiencies).toBe('Arcana,History,Acrobatics,Athletics');
    expect(api.expertise_proficiencies).toBeNull();
    expect(api.tool_proficiencies).toBe('Flute');
    expect(api.saving_throw_proficiencies).toBe('strength,dexterity');
    expect(api.languages).toEqual(['Common', 'Giant']);
  });

  it('names every proficiency key, even when the column is unset', () => {
    const api = mapCharacterToApi({ id: 'char-1', name: 'Blank' } as never)!;

    for (const key of [
      'skill_proficiencies',
      'expertise_proficiencies',
      'tool_proficiencies',
      'saving_throw_proficiencies',
    ]) {
      expect(Object.keys(api)).toContain(key);
    }
  });
});

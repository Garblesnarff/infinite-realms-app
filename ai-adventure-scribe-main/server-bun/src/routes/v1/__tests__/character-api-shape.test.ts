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

describe('mapCharacterToApi vital state (#2517)', () => {
  it('returns vital_state and died_at from the stats row', () => {
    const diedAt = new Date('2026-10-02T14:51:00.000Z');
    const api = mapCharacterToApi({
      ...monk,
      stats: {
        id: 'stats-1',
        characterId: monk.id,
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        armorClass: 11,
        maxHitPoints: 7,
        currentHitPoints: 0,
        temporaryHitPoints: 0,
        initiativeBonus: 0,
        speed: 30,
        vitalState: 'dead',
        diedAt,
        createdAt: diedAt,
        updatedAt: diedAt,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)!;

    expect((api.stats as { vital_state?: string; died_at?: Date }).vital_state).toBe('dead');
    expect((api.stats as { died_at?: Date }).died_at).toEqual(diedAt);
  });
});

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

describe('mapCharacterToApi wire row for the client transform (#1226)', () => {
  it('serializes a campaign-linked character to exactly the shared fixture the client test reads', async () => {
    // The fixture is the JSON body the GET serves (undefined keys drop out on
    // the wire); src/utils/character/__tests__/data-transformers.test.ts runs
    // the real transformCharacterData on it.
    const fixture = (
      await import('../../../../../shared/test-fixtures/character-get-row-1226.json')
    ).default;
    const at = new Date('2026-10-27T20:00:00.000Z');
    const api = mapCharacterToApi({
      id: 'c1226000-0000-4000-8000-000000000001',
      userId: 'user-1226',
      ownerId: 'user-1226',
      campaignId: 'a1226000-0000-4000-8000-000000000002',
      name: 'Clarice Faro',
      race: 'Human',
      class: 'Sorcerer',
      level: 3,
      background: 'Sage',
      theme: null,
      createdAt: at,
      updatedAt: at,
    } as never);
    expect(JSON.parse(JSON.stringify(api))).toEqual(fixture);
  });
});

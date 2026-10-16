import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { characters, characterStats } from '../../../../db/schema/index';

const execute = mock((_query: unknown): Array<{ character_id: string }> => []);

/**
 * Rows for the #620 follow-up recompute (server-derived HP/AC). Keyed by the
 * table the select reads, so the ownership statement under test keeps its
 * exact `execute`-called-once assertion.
 */
const selectRows = (table: unknown) => {
  if (table === characters) return [{ class: 'Wizard', level: 1, subrace: null }];
  if (table === characterStats)
    return [
      {
        dexterity: 10,
        constitution: 10,
        wisdom: 10,
        maxHitPoints: 6,
        currentHitPoints: 6,
        armorClass: 10,
      },
    ];
  return [];
};

const select = mock((_columns: unknown) => ({
  from: (table: unknown) => {
    const rows = selectRows(table);
    return {
      where: (..._args: unknown[]) => ({
        limit: async () => rows,
        // The equipment reads await the where-chain directly (no limit).
        then: (resolve: (value: unknown) => void) => resolve(rows),
      }),
    };
  },
}));

const update = mock((_table: unknown) => ({
  set: (_values: unknown) => ({
    where: (..._args: unknown[]) => Promise.resolve([]),
  }),
}));

mock.module('../../../../db/client', () => ({
  db: {
    execute,
    select,
    update,
  },
}));

const { CharacterService } = await import('../character-service.js');

describe('CharacterService.upsertStats security', () => {
  beforeEach(() => {
    execute.mockClear();
  });

  it('writes through one ownership-scoped statement for an authorized character', async () => {
    execute.mockReturnValue([{ character_id: 'character-1' }]);

    await CharacterService.upsertStats('character-1', 'owner-1', { strength: 18 });

    expect(execute).toHaveBeenCalledTimes(1);
    const statement = execute.mock.calls[0]?.[0] as unknown as {
      queryChunks?: Array<{ value?: unknown } | null | undefined>;
    };
    const statementText = (statement.queryChunks ?? [])
      .map((chunk) => (Array.isArray(chunk?.value) ? chunk.value.join(' ') : ''))
      .join(' ');
    expect(statementText).toContain('authorized_character');
    expect(statementText).toContain('c.user_id');
    expect(statementText).toContain('c.owner_id');
    expect(statementText).toContain('UPDATE character_stats');
    expect(statementText).toContain('INSERT INTO character_stats');
  });

  it('masks unauthorized access as not found and still executes once', async () => {
    execute.mockReturnValue([]);

    await expect(
      CharacterService.upsertStats('character-1', 'other-user', { strength: 18 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

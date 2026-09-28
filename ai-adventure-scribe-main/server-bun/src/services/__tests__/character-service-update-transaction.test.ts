import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { Character } from '../../../../db/schema/index.js';

const select = mock(() => ({
  from: mock(() => ({
    where: mock(() => ({
      limit: mock(async () => []),
    })),
  })),
}));
const update = mock(() => ({
  set: mock(() => ({
    where: mock(() => ({
      returning: mock(async () => [{ id: 'character-1', name: 'Updated Hero' }]),
    })),
  })),
}));
const insert = mock(() => ({ values: mock(async () => undefined) }));
const tx = { insert, select, update };
// The parameter name must not shadow the `tx` binding above (TS2502). (#2313)
type TransactionCallback = (transaction: typeof tx) => Promise<unknown>;
const transaction = mock(async (callback: TransactionCallback) => callback(tx));

mock.module('../../../../db/client', () => ({
  db: {
    transaction,
    select: () => ({ from: () => ({ where: () => ({}) }) }),
  },
}));

const { CharacterService } = await import('../character-service.js');

describe('CharacterService.update equipment transaction', () => {
  beforeEach(() => {
    transaction.mockClear();
    select.mockClear();
    update.mockClear();
    insert.mockClear();
  });

  it('updates the character and equipment through one transaction', async () => {
    const result = await CharacterService.update(
      'character-1',
      'user-1',
      { name: 'Updated Hero' },
      [{ item_name: 'Longsword', item_type: 'weapon', quantity: 1, equipped: true }],
    );

    // The mocked `returning()` row carries only { id, name }; cast the expected
    // value to the service result type so toEqual keeps its exact-shape
    // assertion instead of weakening to toMatchObject. (#2313)
    expect(result).toEqual({
      id: 'character-1',
      name: 'Updated Hero',
    } as Character);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('propagates equipment failure so the transaction can roll back the character update', async () => {
    insert.mockImplementationOnce(() => ({
      values: mock(async () => {
        throw new Error('equipment failed');
      }),
    }));

    await expect(
      CharacterService.update('character-1', 'user-1', { name: 'Updated Hero' }, [
        { item_name: 'Longsword' },
      ]),
    ).rejects.toThrow('equipment failed');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

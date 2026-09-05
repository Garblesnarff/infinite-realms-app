import { beforeEach, describe, expect, it, mock } from 'bun:test';

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
type TransactionCallback = (tx: typeof tx) => Promise<unknown>;
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

    expect(result).toEqual({ id: 'character-1', name: 'Updated Hero' });
    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
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
    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });
});

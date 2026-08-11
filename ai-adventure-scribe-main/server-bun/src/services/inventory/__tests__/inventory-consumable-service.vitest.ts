import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../../db/client';
import { NotFoundError, BusinessLogicError } from '../../../lib/errors.js';
import { InventoryConsumableService } from '../inventory-consumable-service.js';

vi.mock('../../../../../db/client', () => {
  const createChainableMock = () => {
    const mock: any = {
      select: vi.fn(() => mock),
      from: vi.fn(() => mock),
      innerJoin: vi.fn(() => mock),
      where: vi.fn(() => mock),
      limit: vi.fn(() => mock),
      orderBy: vi.fn(() => mock),
      groupBy: vi.fn(() => mock),
      insert: vi.fn(() => mock),
      update: vi.fn(() => mock),
      delete: vi.fn(() => mock),
      set: vi.fn(() => mock),
      values: vi.fn(() => mock),
      returning: vi.fn(() => mock),
      execute: vi.fn(() => mock),
      // Make it awaitable
      then: vi.fn((resolve) => resolve([])),
      catch: vi.fn(),
      finally: vi.fn(),
    };
    return mock;
  };
  return {
    db: createChainableMock(),
  };
});

// Mock schema and other dependencies
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return { ...actual as any };
});

describe('InventoryConsumableService', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';
  const mockItemId = 'item-123';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the then mock to return empty array by default
    (db.then as any).mockImplementation((resolve: any) => resolve([]));
  });

  describe('useConsumable', () => {
    it('should throw NotFoundError if item is not found', async () => {
      (db.then as any).mockImplementation((resolve: any) => resolve([]));

      await expect(
        InventoryConsumableService.useConsumable(
          { characterId: mockCharacterId, itemId: mockItemId, quantity: 1 },
          mockUserId
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessLogicError if insufficient quantity', async () => {
      const mockItem = { id: mockItemId, quantity: 0 };
      (db.then as any).mockImplementation((resolve: any) => resolve([{ item: mockItem }]));

      await expect(
        InventoryConsumableService.useConsumable(
          { characterId: mockCharacterId, itemId: mockItemId, quantity: 1 },
          mockUserId
        )
      ).rejects.toThrow(BusinessLogicError);
    });

    it('should succeed and log usage', async () => {
      const mockItem = { id: mockItemId, quantity: 5 };
      const mockLog = { id: 'log-1' };

      // Mock the sequence of calls: item lookup, ownership check, log insert, update.
      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ item: mockItem }]); // select item
        if (callCount === 2) return resolve([{ one: 1 }]); // ownership check
        if (callCount === 3) return resolve([mockLog]); // insert log
        if (callCount === 4) return resolve([{ ...mockItem, quantity: 4 }]); // update item
        return resolve([]);
      });

      const result = await InventoryConsumableService.useConsumable(
        { characterId: mockCharacterId, itemId: mockItemId, quantity: 1 },
        mockUserId
      );

      expect(result.success).toBe(true);
      expect(result.remainingQuantity).toBe(4);
      expect(result.usageLog).toEqual(mockLog);
      expect(db.insert).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
    });

    it('should delete item if quantity reaches 0', async () => {
      const mockItem = { id: mockItemId, quantity: 1 };
      const mockLog = { id: 'log-1' };

      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ item: mockItem }]); // select item
        if (callCount === 2) return resolve([mockLog]); // insert log
        if (callCount === 3) return resolve([{ id: mockItemId }]); // delete item
        return resolve([]);
      });

      const result = await InventoryConsumableService.useConsumable(
        { characterId: mockCharacterId, itemId: mockItemId, quantity: 1 },
        mockUserId
      );

      expect(result.success).toBe(true);
      expect(result.remainingQuantity).toBe(0);
      expect(result.itemDeleted).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });

    it('should throw InternalServerError if usage log creation fails', async () => {
      const mockItem = { id: mockItemId, quantity: 5 };
      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ item: mockItem }]);
        if (callCount === 2) return resolve([{ one: 1 }]); // ownership check
        if (callCount === 3) return resolve([]); // failed to insert log
        return resolve([]);
      });

      await expect(
        InventoryConsumableService.useConsumable(
          { characterId: mockCharacterId, itemId: mockItemId, quantity: 1 },
          mockUserId
        )
      ).rejects.toThrow('Failed to log consumable usage');
    });
  });

  describe('useAmmunition', () => {
    it('should find ammunition by name and use it', async () => {
      const mockItem = { id: mockItemId, name: 'Arrow', quantity: 10, itemType: 'ammunition' };
      const mockLog = { id: 'log-1' };

      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ item: mockItem }]); // find by name
        if (callCount === 2) return resolve([mockLog]); // insert log (inside useConsumable)
        if (callCount === 3) return resolve([{ ...mockItem, quantity: 9 }]); // update item
        return resolve([]);
      });

      const result = await InventoryConsumableService.useAmmunition(
        mockCharacterId,
        mockUserId,
        'Arrow',
        1
      );

      expect(result.success).toBe(true);
      expect(result.remainingQuantity).toBe(9);
      expect(db.select).toHaveBeenCalled();
    });

    it('should throw NotFoundError if ammunition not found', async () => {
      (db.then as any).mockImplementation((resolve: any) => resolve([]));

      await expect(
        InventoryConsumableService.useAmmunition(mockCharacterId, mockUserId, 'Arrow')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('recoverAmmunition', () => {
    it('should update quantity if ammunition exists', async () => {
      const mockItem = { id: mockItemId, name: 'Arrow', quantity: 10 };

      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ item: mockItem }]); // find
        if (callCount === 2) return resolve([{ ...mockItem, quantity: 15 }]); // update
        return resolve([]);
      });

      const result = await InventoryConsumableService.recoverAmmunition(
        mockCharacterId,
        mockUserId,
        'Arrow',
        5
      );

      expect(result.quantity).toBe(15);
      expect(db.update).toHaveBeenCalled();
    });

    it('should create new item if ammunition does not exist', async () => {
      const newItem = { id: 'new-id', name: 'Arrow', quantity: 5 };

      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([]); // find returns nothing
        if (callCount === 2) return resolve([{ one: 1 }]); // ownership check
        if (callCount === 3) return resolve([newItem]); // insert returns new item
        return resolve([]);
      });

      const result = await InventoryConsumableService.recoverAmmunition(
        mockCharacterId,
        mockUserId,
        'Arrow',
        5
      );

      expect(result.id).toBe('new-id');
      expect(db.insert).toHaveBeenCalled();
    });

    it('should throw InternalServerError if item is missing in results', async () => {
      (db.then as any).mockImplementation((resolve: any) => resolve([{ something: 'else' }]));

      await expect(
        InventoryConsumableService.recoverAmmunition(mockCharacterId, mockUserId, 'Arrow', 5)
      ).rejects.toThrow('Failed to find ammunition item');
    });

    it('should throw InternalServerError if update fails', async () => {
      const mockItem = { id: mockItemId, name: 'Arrow', quantity: 10 };
      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([{ item: mockItem }]);
        if (callCount === 2) return resolve([]); // update returns empty
        return resolve([]);
      });

      await expect(
        InventoryConsumableService.recoverAmmunition(mockCharacterId, mockUserId, 'Arrow', 5)
      ).rejects.toThrow('Failed to update ammunition');
    });

    it('should throw NotFoundError if insert fails to return item', async () => {
      let callCount = 0;
      (db.then as any).mockImplementation((resolve: any) => {
        callCount++;
        if (callCount === 1) return resolve([]); // find returns nothing
        if (callCount === 2) return resolve([]); // insert returns nothing
        return resolve([]);
      });

      await expect(
        InventoryConsumableService.recoverAmmunition(mockCharacterId, mockUserId, 'Arrow', 5)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getUsageHistory', () => {
    it('should return usage log entries', async () => {
      const mockLogs = [{ id: 'log-1' }, { id: 'log-2' }];
      (db.then as any).mockImplementation((resolve: any) => resolve(mockLogs.map(l => ({ log: l }))));

      const result = await InventoryConsumableService.getUsageHistory(
        { characterId: mockCharacterId },
        mockUserId
      );

      expect(result).toHaveLength(2);
      expect(result).toEqual(mockLogs);
      expect(db.select).toHaveBeenCalled();
    });
  });
});

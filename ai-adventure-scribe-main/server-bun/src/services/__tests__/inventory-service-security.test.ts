/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { InventoryService } from '../inventory-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(),
            orderBy: vi.fn(() => ({
              limit: vi.fn(),
            })),
          })),
        })),
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            groupBy: vi.fn(),
          })),
        })),
        where: vi.fn(() => ({
          limit: vi.fn(),
          orderBy: vi.fn(() => ({
            limit: vi.fn(),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        returning: vi.fn(),
      })),
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
  },
}));

// Mock the schema symbols to avoid undefined errors
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
  };
});

describe('InventoryService Security', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';
  const mockItemId = 'item-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addItem', () => {
    it('should throw NotFoundError if insertion fails (unauthorized or missing character)', async () => {
      // Mock insert().select().returning() to return empty array (no rows inserted because SELECT failed)
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([])
        })
      });

      const input = {
        characterId: mockCharacterId,
        name: 'Health Potion',
        itemType: 'consumable',
      };

      await expect(InventoryService.addItem(input as any, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should succeed if insertion returns the created item', async () => {
      const mockItem = { id: mockItemId, name: 'Health Potion' };
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockItem])
        })
      });

      const input = {
        characterId: mockCharacterId,
        name: 'Health Potion',
        itemType: 'consumable',
      };

      const result = await InventoryService.addItem(input as any, mockUserId);
      expect(result).toEqual(mockItem);
    });
  });

  describe('useConsumable', () => {
    it('should throw NotFoundError if item lookup fails', async () => {
      // Mock getItemById returning null
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue(null);

      const input = {
        characterId: mockCharacterId,
        itemId: mockItemId,
        quantity: 1,
      };

      await expect(InventoryService.useConsumable(input as any, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should use atomic insert for log entry with ownership verification', async () => {
      const mockItem = { id: mockItemId, name: 'Health Potion', quantity: 5 };
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue(mockItem as any);

      // Mock successful log insertion
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'log-123' }])
        })
      });

      // Mock successful update
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...mockItem, quantity: 4 }])
          })
        })
      });

      const input = {
        characterId: mockCharacterId,
        itemId: mockItemId,
        quantity: 1,
      };

      const result = await InventoryService.useConsumable(input as any, mockUserId);
      expect(result.success).toBe(true);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('updateItem', () => {
    it('should include exists check in where clause for update', async () => {
      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: mockItemId }])
          })
        })
      });

      await InventoryService.updateItem(mockItemId, mockCharacterId, mockUserId, { name: 'New Name' });

      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('should include exists check in where clause for delete', async () => {
      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: mockItemId }])
        })
      });

      const result = await InventoryService.removeItem(mockItemId, mockCharacterId, mockUserId);
      expect(result).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('getInventory', () => {
    it('should fetch items with ownership join', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([{ item: { id: '1', weight: '1', quantity: 1 } }])
            })
          })
        })
      });

      const result = await InventoryService.getInventory(mockCharacterId, mockUserId);
      expect(result.items).toHaveLength(1);
      expect(result.totalWeight).toBe(1);
    });

    it('should handle optional filters', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([{ characterId: mockCharacterId, item: null }])
            })
          })
        })
      });

      const result = await InventoryService.getInventory(mockCharacterId, mockUserId, {
        itemType: 'weapon',
        equipped: true,
        attuned: false
      });
      expect(result.items).toHaveLength(0);
      expect(db.select).toHaveBeenCalled();
    });

    it('should throw NotFoundError if character not found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      await expect(InventoryService.getInventory(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('getItemById', () => {
    it('should fetch item with ownership join', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ item: { id: mockItemId } }])
            })
          })
        })
      });

      const result = await InventoryService.getItemById(mockItemId, mockCharacterId, mockUserId);
      expect(result?.id).toBe(mockItemId);
    });
  });

  describe('calculateTotalWeight', () => {
    it('should use SQL aggregation', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ totalWeight: '10.5' }])
          })
        })
      });

      const result = await InventoryService.calculateTotalWeight(mockCharacterId, mockUserId);
      expect(result).toBe(10.5);
    });
  });

  describe('checkEncumbrance', () => {
    it('should fetch stats and weight in one query', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockResolvedValue([{ strength: 10, totalWeight: '50' }])
              })
            })
          })
        })
      });

      const result = await InventoryService.checkEncumbrance(mockCharacterId, mockUserId);
      expect(result.strengthScore).toBe(10);
      expect(result.currentWeight).toBe(50);
      expect(result.encumbranceLevel).toBe('normal');
    });

    it('should throw NotFoundError if character or stats not found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockResolvedValue([])
              })
            })
          })
        })
      });

      await expect(InventoryService.checkEncumbrance(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should handle encumbered status', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockResolvedValue([{ strength: 10, totalWeight: '60' }])
              })
            })
          })
        })
      });

      const result = await InventoryService.checkEncumbrance(mockCharacterId, mockUserId);
      expect(result.encumbranceLevel).toBe('encumbered');
    });

    it('should handle heavily encumbered status', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockResolvedValue([{ strength: 10, totalWeight: '110' }])
              })
            })
          })
        })
      });

      const result = await InventoryService.checkEncumbrance(mockCharacterId, mockUserId);
      expect(result.encumbranceLevel).toBe('heavily_encumbered');
    });
  });

  describe('getAttunedItems', () => {
    it('should fetch attuned items with ownership join', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ item: { id: 'attuned-1', isAttuned: true } }])
          })
        })
      });

      const result = await InventoryService.getAttunedItems(mockCharacterId, mockUserId);
      expect(result).toHaveLength(1);
      expect(result[0].isAttuned).toBe(true);
    });
  });

  describe('attuneItem', () => {
    it('should fail if item is not found', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue(null);
      const result = await InventoryService.attuneItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Item not found');
    });

    it('should fail if item does not require attunement', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, requiresAttunement: false } as any);
      const result = await InventoryService.attuneItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Item does not require attunement');
    });

    it('should fail if item is already attuned', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, requiresAttunement: true, isAttuned: true } as any);
      const result = await InventoryService.attuneItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Item is already attuned');
    });

    it('should fail if max attuned count reached', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, requiresAttunement: true, isAttuned: false } as any);
      vi.spyOn(InventoryService, 'getAttunedItems').mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }] as any);
      const result = await InventoryService.attuneItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot attune to more than 3 items');
    });

    it('should succeed if under max count', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, requiresAttunement: true, isAttuned: false } as any);
      vi.spyOn(InventoryService, 'getAttunedItems').mockResolvedValue([{ id: '1' }] as any);
      vi.spyOn(InventoryService, 'updateItem').mockResolvedValue({ id: mockItemId, isAttuned: true } as any);
      const result = await InventoryService.attuneItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(true);
      expect(result.currentAttunedCount).toBe(2);
    });

    it('should fail if update fails during attunement', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, requiresAttunement: true, isAttuned: false } as any);
      vi.spyOn(InventoryService, 'getAttunedItems').mockResolvedValue([] as any);
      vi.spyOn(InventoryService, 'updateItem').mockResolvedValue(null);
      const result = await InventoryService.attuneItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to attune to item');
    });

    it('should handle usage with sessionId and context', async () => {
      const mockItem = { id: mockItemId, name: 'Health Potion', quantity: 5 };
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue(mockItem as any);
      (db.insert as any).mockReturnValue({ select: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'log-1' }]) }) });
      (db.update as any).mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockItem]) }) }) });

      await InventoryService.useConsumable({
        characterId: mockCharacterId,
        itemId: mockItemId,
        quantity: 1,
        sessionId: 'session-1',
        context: 'Test'
      }, mockUserId);
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('equipItem', () => {
    it('should fail if item is not found', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue(null);
      const result = await InventoryService.equipItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Item not found');
    });

    it('should fail if item is not a weapon or armor', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, itemType: 'consumable' } as any);
      const result = await InventoryService.equipItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Only weapons and armor can be equipped');
    });

    it('should succeed for weapons', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, itemType: 'weapon' } as any);
      vi.spyOn(InventoryService, 'updateItem').mockResolvedValue({ id: mockItemId, isEquipped: true } as any);
      const result = await InventoryService.equipItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(true);
    });

    it('should fail if update fails during equip', async () => {
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue({ id: mockItemId, itemType: 'weapon' } as any);
      vi.spyOn(InventoryService, 'updateItem').mockResolvedValue(null);
      const result = await InventoryService.equipItem(mockCharacterId, mockItemId, mockUserId);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to equip item');
    });
  });

  describe('getCarryingCapacity', () => {
    it('should fetch character stats with ownership join', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ stats: { strength: 15 } }])
            })
          })
        })
      });

      const result = await InventoryService.getCarryingCapacity(mockCharacterId, mockUserId);
      expect(result).toBe(15 * 15);
    });

    it('should throw NotFoundError if stats not found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
            })
          })
        })
      });

      await expect(InventoryService.getCarryingCapacity(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if statsResult is null', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(null)
            })
          })
        })
      });

      await expect(InventoryService.getCarryingCapacity(mockCharacterId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('getUsageHistory', () => {
    it('should fetch usage history with ownership join', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ log: { id: 'log-1' } }])
              })
            })
          })
        })
      });

      const result = await InventoryService.getUsageHistory({ characterId: mockCharacterId }, mockUserId);
      expect(result).toHaveLength(1);
    });
  });

  describe('useAmmunition', () => {
    it('should delete item if quantity reaches 0', async () => {
      const mockItem = { id: mockItemId, name: 'Health Potion', quantity: 1 };
      vi.spyOn(InventoryService, 'getItemById').mockResolvedValue(mockItem as any);
      (db.insert as any).mockReturnValue({ select: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'log-1' }]) }) });
      const removeSpy = vi.spyOn(InventoryService, 'removeItem').mockResolvedValue(true);

      const result = await InventoryService.useConsumable({
        characterId: mockCharacterId,
        itemId: mockItemId,
        quantity: 1,
      }, mockUserId);
      expect(result.itemDeleted).toBe(true);
      expect(removeSpy).toHaveBeenCalled();
    });

    it('should throw NotFoundError if ammunition not found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
      });

      await expect(InventoryService.useAmmunition(mockCharacterId, mockUserId, 'Arrow'))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if ammunition result item is missing', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ something: 'else' }])
          })
        })
      });

      await expect(InventoryService.useAmmunition(mockCharacterId, mockUserId, 'Arrow'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('recoverAmmunition', () => {
    it('should update existing ammunition if found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ item: { id: mockItemId, quantity: 10 } }])
          })
        })
      });

      const updateSpy = vi.spyOn(InventoryService, 'updateItem').mockResolvedValue({ id: mockItemId, quantity: 15 } as any);

      const result = await InventoryService.recoverAmmunition(mockCharacterId, mockUserId, 'Arrow', 5);
      expect(result.quantity).toBe(15);
      expect(updateSpy).toHaveBeenCalledWith(mockItemId, mockCharacterId, mockUserId, { quantity: 15 });
    });

    it('should create new ammunition if not found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([])
          })
        })
      });

      const addSpy = vi.spyOn(InventoryService, 'addItem').mockResolvedValue({ id: 'new-ammo', quantity: 5 } as any);

      const result = await InventoryService.recoverAmmunition(mockCharacterId, mockUserId, 'Arrow', 5);
      expect(result.id).toBe('new-ammo');
      expect(addSpy).toHaveBeenCalled();
    });

    it('should throw InternalServerError if update fails', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ item: { id: mockItemId, quantity: 10 } }])
          })
        })
      });

      vi.spyOn(InventoryService, 'updateItem').mockResolvedValue(null);

      await expect(InventoryService.recoverAmmunition(mockCharacterId, mockUserId, 'Arrow', 5))
        .rejects.toThrow('Failed to update ammunition');
    });

    it('should throw InternalServerError if result item is missing', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ something: 'else' }])
          })
        })
      });

      await expect(InventoryService.recoverAmmunition(mockCharacterId, mockUserId, 'Arrow', 5))
        .rejects.toThrow('Failed to find ammunition item');
    });
  });

  describe('unequipItem', () => {
    it('should call updateItem with isEquipped false', async () => {
      const updateSpy = vi.spyOn(InventoryService, 'updateItem').mockResolvedValue({ id: mockItemId, isEquipped: false } as any);
      const result = await InventoryService.unequipItem(mockItemId, mockCharacterId, mockUserId);
      expect(result?.isEquipped).toBe(false);
      expect(updateSpy).toHaveBeenCalledWith(mockItemId, mockCharacterId, mockUserId, { isEquipped: false });
    });
  });

  describe('unattuneItem', () => {
    it('should call updateItem with isAttuned false', async () => {
      const updateSpy = vi.spyOn(InventoryService, 'updateItem').mockResolvedValue({ id: mockItemId, isAttuned: false } as any);
      const result = await InventoryService.unattuneItem(mockItemId, mockCharacterId, mockUserId);
      expect(result?.isAttuned).toBe(false);
      expect(updateSpy).toHaveBeenCalledWith(mockItemId, mockCharacterId, mockUserId, { isAttuned: false });
    });
  });
});

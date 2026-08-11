import { TRPCError } from '@trpc/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { CharacterPermissionService } from '../character-permission-service.js';

// Mock the database client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      characterPermissions: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('CharacterService Permissions', () => {
  const mockUserId = 'user-123';
  const mockTargetUserId = 'user-456';
  const mockCharacterId = 'char-789';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPermissions', () => {
    it('should list permissions for character owner', async () => {
      const mockPermissions = [
        { id: 'perm-1', characterId: mockCharacterId, userId: mockTargetUserId, permissionLevel: 'viewer' },
      ];

      // Mock join result
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockPermissions.map(p => ({ permission: p, ownerId: mockUserId, charUserId: mockUserId }))),
          }),
        }),
      });

      const result = await CharacterPermissionService.listPermissions(mockCharacterId, mockUserId);

      expect(result).toEqual(mockPermissions);
      expect(db.select).toHaveBeenCalled();
    });

    it('should throw NOT_FOUND if character not owned by user', async () => {
      // Mock empty join result (not owned or not found)
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(CharacterPermissionService.listPermissions(mockCharacterId, mockUserId))
        .rejects.toThrow(new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' }));
    });
  });

  describe('shareCharacter', () => {
    it('should throw NOT_FOUND if character not owned by user', async () => {
      // Mock result for existence/ownership check
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      await expect(CharacterPermissionService.shareCharacter(mockCharacterId, mockUserId, mockTargetUserId, 'viewer'))
        .rejects.toThrow(new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' }));
    });

    it('should throw CONFLICT if permission already exists', async () => {
      // Mock result showing existing permission
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ characterId: mockCharacterId, existingPermissionId: 'perm-1' }]),
            }),
          }),
        }),
      });

      await expect(CharacterPermissionService.shareCharacter(mockCharacterId, mockUserId, mockTargetUserId, 'viewer'))
        .rejects.toThrow(new TRPCError({ code: 'CONFLICT', message: 'Permission already exists for this user' }));
    });
  });

  describe('updatePermission', () => {
    it('should throw NOT_FOUND if character not owned or permission missing', async () => {
      // Mock the subquery inside exists()
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({}),
        }),
      });

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        CharacterPermissionService.updatePermission(mockCharacterId, mockUserId, mockTargetUserId, 'editor')
      ).rejects.toThrow(new TRPCError({ code: 'NOT_FOUND', message: 'Permission not found' }));
    });
  });

  describe('revokePermission', () => {
    it('should return true if permission revoked by owner', async () => {
      // Mock the subquery inside exists()
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({}),
        }),
      });

      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'perm-1' }]),
        }),
      });

      const result = await CharacterPermissionService.revokePermission(
        mockCharacterId,
        mockUserId,
        mockTargetUserId
      );

      expect(result).toBe(true);
    });

    it('should return false if permission not found or not owned', async () => {
      // Mock the subquery inside exists()
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({}),
        }),
      });

      (db.delete as any).mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await CharacterPermissionService.revokePermission(
        mockCharacterId,
        mockUserId,
        mockTargetUserId
      );

      expect(result).toBe(false);
    });
  });
});

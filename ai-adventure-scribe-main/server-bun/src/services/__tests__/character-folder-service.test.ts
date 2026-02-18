/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../../db/client';
import { CharacterFolderService } from '../character-folder-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characterFolders: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      characters: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock drizzle-orm symbols
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    sql: vi.fn((strings) => strings[0]),
  };
});

describe('CharacterFolderService Optimization', () => {
  const mockUserId = 'user-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listFolders', () => {
    it('should use single aggregation query for character counts', async () => {
      // Mock folders
      const mockFolders = [
        { id: 'folder-1', name: 'Folder 1', parentFolderId: null, sortOrder: 0 },
        { id: 'folder-2', name: 'Folder 2', parentFolderId: null, sortOrder: 1 },
      ];
      (db.query.characterFolders.findMany as any).mockResolvedValue(mockFolders);

      // Mock aggregated counts
      const mockCounts = [
        { folderId: 'folder-1', count: 5 },
        { folderId: 'folder-2', count: 3 },
      ];

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(mockCounts),
      };
      (db.select as any).mockReturnValue(mockSelect);

      const result = await CharacterFolderService.listFolders(mockUserId);

      // Verify folders were fetched
      expect(db.query.characterFolders.findMany).toHaveBeenCalled();

      // Verify aggregation query was used (Bolt optimization)
      expect(db.select).toHaveBeenCalled();
      expect(mockSelect.groupBy).toHaveBeenCalled();

      // Verify character counts are correctly mapped
      expect(result).toHaveLength(2);
      expect(result.find(f => f.id === 'folder-1')?.characterCount).toBe(5);
      expect(result.find(f => f.id === 'folder-2')?.characterCount).toBe(3);
    });

    it('should return nested folder structure', async () => {
      const mockFolders = [
        { id: 'parent', name: 'Parent', parentFolderId: null, sortOrder: 0 },
        { id: 'child', name: 'Child', parentFolderId: 'parent', sortOrder: 0 },
      ];
      (db.query.characterFolders.findMany as any).mockResolvedValue(mockFolders);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue([]),
      });

      const result = await CharacterFolderService.listFolders(mockUserId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('parent');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].id).toBe('child');
    });
  });
});

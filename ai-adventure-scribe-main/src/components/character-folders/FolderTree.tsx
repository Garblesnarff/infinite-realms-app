
/**
 * FolderTree Component
 *
 * Displays a hierarchical folder tree for organizing characters
 * Features:
 * - Nested folder structure with expand/collapse
 * - Drag & drop characters between folders
 * - Drag to reorder folders
 * - Create new folder button
 * - Folder color indicators
 * - Character count badges
 * - Context menu for folder actions
 */

import { FolderOpen, FolderPlus } from 'lucide-react';
import React, { useCallback } from 'react';

import { FolderItem } from './FolderItem';

import type { FolderNode, FolderTreeProps } from './types';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/infrastructure/api/trpc-hooks';
import { cn } from '@/lib/utils';


/**
 * Main FolderTree component
 */
export const FolderTree: React.FC<FolderTreeProps> = ({
  onFolderSelect,
  selectedFolderId,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  onChangeColor,
  onCharacterDrop,
}) => {
  const trpc = useTRPC();

  // Fetch folders
  const { data: folders, isLoading, error } = trpc.characterFolders.list.useQuery();

  // Build folder tree structure
  const buildTree = useCallback(
    (
      folders: {
        id: string;
        name: string;
        color?: string | null;
        icon?: string | null;
        parentFolderId?: string | null;
        characterCount?: number | null;
      }[],
    ): FolderNode[] => {
      if (!folders) return [];

      const folderMap = new Map<string, FolderNode>();
      const rootFolders: FolderNode[] = [];

      // Create folder nodes
      folders.forEach((folder) => {
        folderMap.set(folder.id, {
          id: folder.id,
          name: folder.name,
          color: folder.color || undefined,
          icon: folder.icon || undefined,
          parentFolderId: folder.parentFolderId,
          characterCount: folder.characterCount || 0,
          children: [],
        });
      });

      // Build tree structure
      folderMap.forEach((folder) => {
        if (folder.parentFolderId) {
          const parent = folderMap.get(folder.parentFolderId);
          if (parent && parent.children) {
            parent.children.push(folder);
          }
        } else {
          rootFolders.push(folder);
        }
      });

      return rootFolders;
    },
    [],
  );

  const folderTree = buildTree(folders || []);

  const handleSelect = useCallback(
    (folderId: string | null) => {
      if (onFolderSelect) {
        onFolderSelect(folderId);
      }
    },
    [onFolderSelect],
  );

  const handleEdit = useCallback(
    (folderId: string) => {
      if (onEditFolder) {
        onEditFolder(folderId);
      }
    },
    [onEditFolder],
  );

  const handleDelete = useCallback(
    (folderId: string) => {
      if (onDeleteFolder) {
        onDeleteFolder(folderId);
      }
    },
    [onDeleteFolder],
  );

  const handleChangeColor = useCallback(
    (folderId: string) => {
      if (onChangeColor) {
        onChangeColor(folderId);
      }
    },
    [onChangeColor],
  );

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">Failed to load folders. Please try again.</div>
    );
  }

  return (
    <div className="w-full">
      {/* Header with Create Button */}
      <div className="flex items-center justify-between mb-4 px-3">
        <h3 className="text-sm font-semibold text-foreground">Folders</h3>
        {onCreateFolder && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCreateFolder}
            className="h-8 gap-2"
            title="Create a new character folder"
            aria-label="Create a new character folder"
          >
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
            New Folder
          </Button>
        )}
      </div>

      {/* All Characters (Root) */}
      <div
        role="button"
        tabIndex={0}
        aria-selected={selectedFolderId === null}
        aria-label="Show all characters"
        title="Show all characters"
        className={cn(
          'flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all duration-200 mb-2 outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple',
          selectedFolderId === null && 'bg-infinite-purple/10 border-l-2 border-infinite-purple',
          selectedFolderId !== null && 'hover:bg-accent',
        )}
        onClick={() => handleSelect(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect(null);
          }
        }}
      >
        <FolderOpen className="h-5 w-5 text-infinite-teal" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium">All Characters</span>
      </div>

      {/* Folder Tree */}
      {isLoading ? (
        <div className="space-y-2 px-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-accent/50 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : folderTree.length === 0 ? (
        <div
          className="px-3 py-8 text-center text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          No folders yet. Create one to organize your characters.
        </div>
      ) : (
        <div className="space-y-1">
          {folderTree.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              level={0}
              isSelected={selectedFolderId === folder.id}
              onSelect={handleSelect}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onChangeColor={handleChangeColor}
              onCharacterDrop={onCharacterDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FolderTree;

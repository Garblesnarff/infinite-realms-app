import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  MoreVertical,
  Edit,
  Trash2,
  Palette,
} from 'lucide-react';
import React, { useState, useCallback } from 'react';

import type { FolderItemProps } from './types';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';


/**
 * Individual folder item with expand/collapse and context menu
 */
export const FolderItem: React.FC<FolderItemProps> = ({
  folder,
  level,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onChangeColor,
  onCharacterDrop,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);

  const hasChildren = folder.children && folder.children.length > 0;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const characterId = e.dataTransfer.getData('characterId');
      if (characterId && onCharacterDrop) {
        onCharacterDrop(characterId, folder.id);
      }
    },
    [folder.id, onCharacterDrop],
  );

  return (
    <div className="select-none">
      <div
        role="button"
        tabIndex={0}
        aria-selected={isSelected}
        aria-label={`Select folder: ${folder.name}`}
        title={`Select folder: ${folder.name}`}
        className={cn(
          'group flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple',
          isSelected && 'bg-infinite-purple/10 border-l-2 border-infinite-purple',
          isDragOver && 'bg-infinite-gold/20 border-2 border-dashed border-infinite-gold',
          !isSelected && !isDragOver && 'hover:bg-accent',
        )}
        style={{ paddingLeft: `${level * 1.5 + 0.75}rem` }}
        onClick={() => onSelect(folder.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(folder.id);
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Expand/Collapse Icon */}
        {hasChildren && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-4 w-4 p-0 hover:bg-accent rounded"
            aria-label={isExpanded ? `Collapse ${folder.name} folder` : `Expand ${folder.name} folder`}
            title={isExpanded ? `Collapse ${folder.name} folder` : `Expand ${folder.name} folder`}
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        )}
        {!hasChildren && <div className="w-4" />}

        {/* Folder Icon with Color */}
        <div className="flex-shrink-0" style={{ color: folder.color || undefined }}>
          {isExpanded && hasChildren ? (
            <FolderOpen className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Folder className="h-5 w-5" aria-hidden="true" />
          )}
        </div>

        {/* Folder Name */}
        <span className="flex-1 text-sm font-medium truncate" title={folder.name}>
          {folder.name}
        </span>

        {/* Character Count Badge */}
        {folder.characterCount > 0 && (
          <Badge
            variant="secondary"
            className="text-xs"
            aria-label={`${folder.characterCount} characters`}
            title={`${folder.characterCount} characters in this folder`}
          >
            {folder.characterCount}
          </Badge>
        )}

        {/* Context Menu */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  aria-label={`Actions for ${folder.name} folder`}
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Actions for {folder.name} folder</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onEdit(folder.id);
              }}
            >
              <Edit className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onChangeColor(folder.id);
              }}
            >
              <Palette className="mr-2 h-4 w-4" />
              Change Color
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDelete(folder.id);
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nested Children */}
      {isExpanded && hasChildren && folder.children && (
        <div className="mt-1">
          {folder.children.map((child) => (
            <FolderItem
              key={child.id}
              folder={child}
              level={level + 1}
              isSelected={isSelected}
              onSelect={onSelect}
              onEdit={onEdit}
              onDelete={onDelete}
              onChangeColor={onChangeColor}
              onCharacterDrop={onCharacterDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
};

import { Check, Copy, Edit, Eye, MoreVertical, Trash2 } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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

interface SceneListItemProps {
  scene: any;
  onViewScene?: (sceneId: string) => void;
  onEditScene?: (sceneId: string) => void;
  onSetActive: (sceneId: string) => void;
  onDuplicate: (scene: any) => void;
  onDelete: (sceneId: string) => void;
}

/**
 * Individual Scene List Item for List View
 * Extracted from SceneManager.tsx
 */
export const SceneListItem: React.FC<SceneListItemProps> = ({
  scene,
  onViewScene,
  onEditScene,
  onSetActive,
  onDuplicate,
  onDelete,
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card
          variant="parchment"
          role="button"
          tabIndex={0}
          className={cn(
            'overflow-hidden transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple',
            scene.isActive && 'ring-2 ring-electricCyan',
          )}
          onClick={() => onViewScene?.(scene.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onViewScene?.(scene.id);
            }
          }}
          aria-label={`View scene: ${scene.name}`}
        >
      <div className="flex items-center gap-4 p-4">
        {/* Thumbnail */}
        <div className="relative w-24 h-24 bg-gradient-to-br from-slate-100 to-slate-200 rounded overflow-hidden flex-shrink-0">
          {scene.thumbnailUrl || scene.backgroundImageUrl ? (
            <img
              src={scene.thumbnailUrl || scene.backgroundImageUrl}
              alt={scene.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-4xl text-slate-400">
              🗺️
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold truncate" title={scene.name}>
              {scene.name}
            </h3>
            {scene.isActive && (
              <Badge className="bg-electricCyan text-white">
                <Eye className="mr-1 h-3 w-3" aria-hidden="true" />
                Active
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            {scene.width} × {scene.height} squares • {scene.gridType}
          </p>
          {scene.description && (
            <p className="text-sm text-muted-foreground line-clamp-1">
              {scene.description}
            </p>
          )}
        </div>

        {/* Actions */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Open menu for ${scene.name}`}
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Open menu for {scene.name}</p>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onViewScene?.(scene.id);
              }}
            >
              <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
              View Scene
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onEditScene?.(scene.id);
              }}
            >
              <Edit className="mr-2 h-4 w-4" aria-hidden="true" />
              Edit
            </DropdownMenuItem>
            {!scene.isActive && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onSetActive(scene.id);
                }}
              >
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                Set as Active
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(scene);
              }}
            >
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(scene.id);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
      </TooltipTrigger>
      <TooltipContent>
        <p>View scene: {scene.name}</p>
      </TooltipContent>
    </Tooltip>
  );
};

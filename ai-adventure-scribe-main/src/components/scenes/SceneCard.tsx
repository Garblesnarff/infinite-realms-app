import { Check, Copy, Edit, Eye, MoreVertical, Trash2 } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

interface SceneCardProps {
  scene: any;
  onViewScene?: (sceneId: string) => void;
  onEditScene?: (sceneId: string) => void;
  onSetActive: (sceneId: string) => void;
  onDuplicate: (scene: any) => void;
  onDelete: (sceneId: string) => void;
}

/**
 * Individual Scene Card for Grid View
 * Extracted from SceneManager.tsx
 */
export const SceneCard: React.FC<SceneCardProps> = ({
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
            scene.isActive && 'ring-4 ring-electricCyan shadow-lg shadow-electricCyan/50',
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
      {/* Thumbnail */}
      <div className="relative h-48 bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden">
        {scene.thumbnailUrl || scene.backgroundImageUrl ? (
          <img
            src={scene.thumbnailUrl || scene.backgroundImageUrl}
            alt={scene.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-6xl text-slate-400">
            🗺️
          </div>
        )}
        {scene.isActive && (
          <Badge className="absolute top-2 left-2 bg-electricCyan text-white">
            <Eye className="mr-1 h-3 w-3" aria-hidden="true" />
            Active
          </Badge>
        )}
      </div>

      {/* Content */}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <CardTitle
                  className="text-lg truncate cursor-default outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm"
                  tabIndex={0}
                >
                  {scene.name}
                </CardTitle>
              </TooltipTrigger>
              <TooltipContent>
                <p>{scene.name}</p>
              </TooltipContent>
            </Tooltip>
            <CardDescription className="text-xs mt-1">
              {scene.width} × {scene.height} squares
            </CardDescription>
          </div>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
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
      </CardHeader>

      {scene.description && (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground line-clamp-2">{scene.description}</p>
        </CardContent>
      )}
    </Card>
      </TooltipTrigger>
      <TooltipContent>
        <p>View scene: {scene.name}</p>
      </TooltipContent>
    </Tooltip>
  );
};

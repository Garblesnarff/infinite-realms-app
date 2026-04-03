/**
 * Tool Options Panel Component
 *
 * Contextual options panel that displays settings for the active tool.
 * Provides tool-specific controls like stroke width, colors, template types, etc.
 *
 * Features:
 * - Contextual options based on active tool
 * - Stroke width slider for drawing tools
 * - Color pickers for drawing
 * - Template type selector for AoE tool
 * - Wall type selector for wall tool
 * - Fog brush size for fog tool
 * - Collapsible panel
 * - Auto-show when tool is selected
 * - Configurable position (top, side, floating)
 *
 * @module components/battle-map/ToolOptionsPanel
 */

import { Paintbrush, ChevronDown, ChevronUp } from 'lucide-react';
import React, { useState, useEffect, useId } from 'react';

import { AoEOptions } from './tool-options/AoEOptions';
import { DrawOptions } from './tool-options/DrawOptions';
import { FogOptions } from './tool-options/FogOptions';
import { MeasureOptions } from './tool-options/MeasureOptions';
import { WallOptions } from './tool-options/WallOptions';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Z_INDEX } from '@/constants/z-index';
import { useDrawingTool } from '@/hooks/use-drawing-tool';
import { cn } from '@/lib/utils';
import { useBattleMapStore } from '@/stores/useBattleMapStore';

// ===========================
// Types
// ===========================

export interface ToolOptionsPanelProps {
  /** Current scene ID */
  sceneId: string;
  /** User ID */
  userId?: string;
  /** Position of the panel */
  position?: 'top' | 'left' | 'right' | 'floating';
  /** Custom className */
  className?: string;
  /** Auto-collapse when no tool is selected */
  autoCollapse?: boolean;
  /** Initial collapsed state */
  defaultCollapsed?: boolean;
  /** Callback when options change */
  onOptionsChange?: (options: ToolOptions) => void;
}

export interface ToolOptions {
  strokeWidth?: number;
  strokeColor?: string;
  fillColor?: string;
  fillOpacity?: number;
  fillEnabled?: boolean;
  templateType?: 'cone' | 'cube' | 'sphere' | 'line' | 'cylinder';
  wallType?: 'solid' | 'door' | 'window' | 'terrain';
  fogBrushSize?: number;
  fogBrushMode?: 'reveal' | 'conceal';
  snapToGrid?: boolean;
}

// ===========================
// Tool Options Panel Component
// ===========================

export const ToolOptionsPanel: React.FC<ToolOptionsPanelProps> = ({
  sceneId,
  userId,
  position = 'top',
  className,
  autoCollapse = true,
  defaultCollapsed = false,
  onOptionsChange,
}) => {
  const selectedTool = useBattleMapStore((state) => state.selectedTool);
  const wallType = useBattleMapStore((state) => state.wallType);
  const setWallType = useBattleMapStore((state) => state.setWallType);
  const fogBrushSize = useBattleMapStore((state) => state.fogBrushSize);
  const setFogBrushSize = useBattleMapStore((state) => state.setFogBrushSize);
  const fogBrushMode = useBattleMapStore((state) => state.fogBrushMode);
  const setFogBrushMode = useBattleMapStore((state) => state.setFogBrushMode);
  const wallSnapToGrid = useBattleMapStore((state) => state.wallSnapToGrid);
  const toggleWallSnapToGrid = useBattleMapStore((state) => state.toggleWallSnapToGrid);

  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [templateType, setTemplateType] = useState<
    'cone' | 'cube' | 'sphere' | 'line' | 'cylinder'
  >('cone');

  // Accessibility IDs
  const strokeWidthId = useId();
  const fillOpacityId = useId();
  const templateTypeId = useId();
  const aoeOpacityId = useId();
  const wallTypeId = useId();
  const wallStrokeWidthId = useId();
  const brushModeId = useId();
  const brushSizeId = useId();
  const contentId = useId();

  // Drawing tool state
  const drawingTool = useDrawingTool({
    sceneId,
    userId,
  });

  // Auto-collapse when no relevant tool is selected
  useEffect(() => {
    if (autoCollapse && selectedTool === 'select') {
      setIsCollapsed(true);
    } else if (selectedTool && selectedTool !== 'select') {
      setIsCollapsed(false);
    }
  }, [selectedTool, autoCollapse]);

  // Notify parent of option changes
  useEffect(() => {
    if (onOptionsChange) {
      onOptionsChange({
        strokeWidth: drawingTool.state.strokeWidth,
        strokeColor: drawingTool.state.strokeColor,
        fillColor: drawingTool.state.fillColor,
        fillOpacity: drawingTool.state.fillOpacity,
        fillEnabled: drawingTool.state.fillEnabled,
        templateType,
        wallType,
        fogBrushSize,
        fogBrushMode,
        snapToGrid: wallSnapToGrid,
      });
    }
  }, [
    drawingTool.state,
    templateType,
    wallType,
    fogBrushSize,
    fogBrushMode,
    wallSnapToGrid,
    onOptionsChange,
  ]);

  // ===========================
  // Render Tool-Specific Options
  // ===========================

  const renderToolOptions = () => {
    switch (selectedTool) {
      case 'draw':
        return (
          <DrawOptions
            strokeWidth={drawingTool.state.strokeWidth}
            setStrokeWidth={drawingTool.setStrokeWidth}
            strokeColor={drawingTool.state.strokeColor}
            setStrokeColor={drawingTool.setStrokeColor}
            fillEnabled={drawingTool.state.fillEnabled}
            setFillEnabled={drawingTool.setFillEnabled}
            fillColor={drawingTool.state.fillColor}
            setFillColor={drawingTool.setFillColor}
            fillOpacity={drawingTool.state.fillOpacity}
            setFillOpacity={drawingTool.setFillOpacity}
            strokeWidthId={strokeWidthId}
            fillOpacityId={fillOpacityId}
          />
        );
      case 'move': // AoE tool
        return (
          <AoEOptions
            templateType={templateType}
            setTemplateType={setTemplateType}
            fillColor={drawingTool.state.fillColor}
            setFillColor={drawingTool.setFillColor}
            fillOpacity={drawingTool.state.fillOpacity}
            setFillOpacity={drawingTool.setFillOpacity}
            templateTypeId={templateTypeId}
            aoeOpacityId={aoeOpacityId}
          />
        );
      case 'wall':
        return (
          <WallOptions
            wallType={wallType}
            setWallType={setWallType}
            snapToGrid={wallSnapToGrid}
            toggleSnapToGrid={toggleWallSnapToGrid}
            strokeWidth={drawingTool.state.strokeWidth}
            setStrokeWidth={drawingTool.setStrokeWidth}
            wallTypeId={wallTypeId}
            wallStrokeWidthId={wallStrokeWidthId}
          />
        );
      case 'fog-brush':
        return (
          <FogOptions
            brushMode={fogBrushMode}
            setBrushMode={setFogBrushMode}
            brushSize={fogBrushSize}
            setBrushSize={setFogBrushSize}
            brushModeId={brushModeId}
            brushSizeId={brushSizeId}
          />
        );
      case 'measure':
        return (
          <MeasureOptions
            strokeColor={drawingTool.state.strokeColor}
            setStrokeColor={drawingTool.setStrokeColor}
          />
        );
      case 'pan':
      case 'select':
      default:
        return (
          <div className="text-sm text-muted-foreground text-center py-4">
            No options available for this tool
          </div>
        );
    }
  };

  // Don't render if no tool is selected and autoCollapse is true
  if (autoCollapse && !selectedTool) {
    return null;
  }

  // ===========================
  // Render
  // ===========================

  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={setIsCollapsed}
      className={cn(
        'bg-background border rounded-lg shadow-md',
        position === 'top' && 'fixed top-4 left-1/2 -translate-x-1/2 w-80',
        position === 'left' && 'fixed left-20 top-4 w-80',
        position === 'right' && 'fixed right-4 top-4 w-80',
        position === 'floating' && 'absolute w-80',
        className,
      )}
      style={{ zIndex: Z_INDEX.FLOATING_PANEL }}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full flex items-center justify-between p-3 hover:bg-accent"
          aria-label={isCollapsed ? 'Expand Tool Options' : 'Collapse Tool Options'}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
        >
          <div className="flex items-center gap-2">
            <Paintbrush className="h-4 w-4" />
            <span className="font-medium">Tool Options</span>
            {selectedTool && (
              <span className="text-xs text-muted-foreground capitalize">({selectedTool})</span>
            )}
          </div>
          {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent id={contentId}>
        <Separator />
        <div className="p-4">{renderToolOptions()}</div>
      </CollapsibleContent>
    </Collapsible>
  );
};

// ===========================
// Exports
// ===========================

export type { ToolOptionsPanelProps, ToolOptions };

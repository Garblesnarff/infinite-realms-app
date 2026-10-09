/**
 * Layers Panel Component
 *
 * Provides a UI panel for controlling battle map layers.
 * Allows users to toggle visibility, lock layers, and adjust opacity.
 *
 * Features:
 * - Eye icon to toggle layer visibility
 * - Lock icon to lock/unlock layers
 * - Opacity slider for each layer
 * - Responsive design (collapsible on mobile)
 * - Syncs with backend via tRPC mutations
 * - Uses Shadcn UI components (Sheet, Slider, Switch)
 */

import { Eye, EyeOff, Lock, Layers, RotateCcw } from 'lucide-react';
import React, { useCallback } from 'react';
import { toast } from 'sonner';

import { LayerControlItem } from './LayerControlItem';
import { LAYER_CONFIGS } from './LayerManager';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/infrastructure/api';
import { useBattleMapStore } from '@/stores/useBattleMapStore';

// ===========================
// Types
// ===========================

export interface LayersPanelProps {
  sceneId: string;
  /**
   * Side of the screen where the panel should appear
   */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /**
   * Show panel by default (controlled mode)
   */
  open?: boolean;
  /**
   * Callback when panel open state changes
   */
  onOpenChange?: (open: boolean) => void;
}

// ===========================
// Main LayersPanel Component
// ===========================

export const LayersPanel: React.FC<LayersPanelProps> = React.memo(
  ({ sceneId, side = 'right', open, onOpenChange }) => {
    const [isOpen, setIsOpen] = React.useState(false);

    // Use controlled or uncontrolled mode
    const actualOpen = open !== undefined ? open : isOpen;

    // ⚡ Bolt: Stable handler for open state changes
    const actualOnOpenChange = useCallback(
      (val: boolean) => {
        if (onOpenChange) {
          onOpenChange(val);
        } else {
          setIsOpen(val);
        }
      },
      [onOpenChange],
    );

    // Fetch scene data to get layer IDs
    const { data: sceneData } = trpc.scenes.getById.useQuery(
      { sceneId },
      {
        enabled: !!sceneId,
      },
    );

    // Create a map of layer type to layer ID
    const layerIdMap = React.useMemo(() => {
      if (!sceneData?.layers) return {};

      const map: Record<string, string> = {};
      sceneData.layers.forEach((layer: { id: string; layerType?: string | null }) => {
        if (layer.layerType) {
          map[layer.layerType] = layer.id;
        }
      });
      return map;
    }, [sceneData]);

    // ⚡ Bolt: Memoized quick actions to prevent re-creation on every render
    const handleShowAll = useCallback(() => {
      LAYER_CONFIGS.forEach((layer) => {
        useBattleMapStore.getState().setLayerVisibility(layer.id, true);
      });
      toast.success('All layers shown');
    }, []);

    const handleHideAll = useCallback(() => {
      LAYER_CONFIGS.forEach((layer) => {
        useBattleMapStore.getState().setLayerVisibility(layer.id, false);
      });
      toast.success('All layers hidden');
    }, []);

    const handleReset = useCallback(() => {
      useBattleMapStore.getState().resetLayers();
      toast.success('Layers reset to defaults');
    }, []);

    return (
      <Sheet open={actualOpen} onOpenChange={actualOnOpenChange}>
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  aria-label="Open layers panel"
                >
                  <Layers className="h-5 w-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
            </TooltipTrigger>
            <TooltipContent side={side === 'left' ? 'right' : 'left'}>
              <p>Open layers panel</p>
            </TooltipContent>
          </Tooltip>

          <SheetContent side={side} className="w-[350px] sm:w-[400px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Layer Controls</SheetTitle>
              <SheetDescription>
                Manage layer visibility, lock status, and opacity for the battle map.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              {/* Instructions */}
              <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-lg">
                <p className="mb-2 font-medium text-foreground">Layer Controls:</p>
                <ul className="space-y-1 text-xs">
                  <li className="flex items-center gap-2">
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    <span>Toggle layer visibility</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    <span>Lock layer to prevent interactions</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-3 h-3 bg-muted rounded-sm" aria-hidden="true" />
                    <span>Adjust opacity with slider</span>
                  </li>
                </ul>
              </div>

              <Separator />

              {/* Layer List */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Layers
                </h3>

                {LAYER_CONFIGS.map((layer) => {
                  const layerId = layerIdMap[layer.type];

                  // Skip if layer doesn't exist in the scene yet
                  if (!layerId) {
                    return (
                      <div
                        key={layer.id}
                        className="p-3 rounded-lg bg-muted/20 text-muted-foreground text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-sm"
                            aria-hidden="true"
                            style={{
                              backgroundColor: `hsla(${layer.zIndex * 60}, 70%, 50%, 0.3)`,
                            }}
                          />
                          <Tooltip delayDuration={300}>
                            <TooltipTrigger asChild>
                              <span
                                className="truncate max-w-[150px] cursor-help outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm"
                                tabIndex={0}
                              >
                                {layer.name}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>{layer.name}</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs text-muted-foreground">(Not initialized)</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <LayerControlItem
                      key={layer.id}
                      layer={layer}
                      sceneId={sceneId}
                      layerId={layerId}
                    />
                  );
                })}
              </div>

              <Separator />

              {/* Quick Actions */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Quick Actions
                </h3>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Layer quick actions">
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleShowAll}
                        aria-label="Show all map layers"
                      >
                        <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
                        Show All
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Show all map layers</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleHideAll}
                        aria-label="Hide all map layers"
                      >
                        <EyeOff className="mr-2 h-4 w-4" aria-hidden="true" />
                        Hide All
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Hide all map layers</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleReset}
                        aria-label="Reset layers to default visibility and opacity"
                      >
                        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Reset
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Reset layers to default visibility and opacity</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </SheetContent>
        </TooltipProvider>
      </Sheet>
    );
  },
);

export default LayersPanel;

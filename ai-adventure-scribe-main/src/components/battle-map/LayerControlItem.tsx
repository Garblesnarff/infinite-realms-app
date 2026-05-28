import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import React, { useId, useCallback } from 'react';
import { toast } from 'sonner';

import { type LayerConfig } from './LayerManager';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { trpc } from '@/lib/trpc';
import { useBattleMapStore } from '@/stores/useBattleMapStore';

interface LayerControlItemProps {
  layer: LayerConfig;
  sceneId: string;
  layerId: string;
}

export const LayerControlItem: React.FC<LayerControlItemProps> = React.memo(
  ({ layer, sceneId, layerId }) => {
    const opacityId = useId();

    // ⚡ Bolt: Targeted selectors ensure this component only re-renders when
    // its specific layer state changes, rather than on any store update.
    const visible = useBattleMapStore((state) => state.layerVisibility[layer.id] ?? true);
    const opacity = useBattleMapStore((state) => state.layerOpacity[layer.id] ?? 1);
    const locked = useBattleMapStore((state) => state.layerLocked[layer.id] ?? false);

    const toggleLayerVisibility = useBattleMapStore((state) => state.toggleLayerVisibility);
    const toggleLayerLock = useBattleMapStore((state) => state.toggleLayerLock);
    const setLayerOpacity = useBattleMapStore((state) => state.setLayerOpacity);

    const utils = trpc.useUtils();

    // tRPC mutation for updating layer on backend
    const updateLayer = trpc.scenes.updateLayer.useMutation({
      onSuccess: () => {
        // Invalidate scene query to refresh data
        utils.scenes.getById.invalidate({ sceneId });
      },
      onError: (error) => {
        toast.error(`Failed to update layer: ${error.message}`);
      },
    });

    const handleVisibilityToggle = useCallback(() => {
      const newVisibility = !visible;
      toggleLayerVisibility(layer.id);

      // Update backend
      updateLayer.mutate({
        sceneId,
        layerId,
        updates: {
          isVisible: newVisibility,
        },
      });
    }, [visible, toggleLayerVisibility, layer.id, updateLayer, sceneId, layerId]);

    const handleLockToggle = useCallback(() => {
      const newLocked = !locked;
      toggleLayerLock(layer.id);

      // Update backend
      updateLayer.mutate({
        sceneId,
        layerId,
        updates: {
          locked: newLocked,
        },
      });
    }, [locked, toggleLayerLock, layer.id, updateLayer, sceneId, layerId]);

    const handleOpacityChange = useCallback(
      (values: number[]) => {
        const newOpacity = values[0] ?? 1;
        setLayerOpacity(layer.id, newOpacity);
      },
      [setLayerOpacity, layer.id],
    );

    const handleOpacityCommit = useCallback(
      (values: number[]) => {
        const newOpacity = values[0] ?? 1;

        // Update backend when user releases slider
        updateLayer.mutate({
          sceneId,
          layerId,
          updates: {
            opacity: newOpacity.toFixed(2),
          },
        });
      },
      [updateLayer, sceneId, layerId],
    );

    return (
      <div className="space-y-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
        {/* Layer Name and Controls */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className="w-3 h-3 rounded-sm shrink-0"
              aria-hidden="true"
              style={{
                backgroundColor: `hsla(${layer.zIndex * 60}, 70%, 50%, 0.7)`,
              }}
            />
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <span className="font-medium text-sm truncate cursor-help">
                  {layer.name}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{layer.name}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Visibility Toggle */}
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="h-8 w-8"
                  onClick={handleVisibilityToggle}
                  aria-label={visible ? `Hide ${layer.name} layer` : `Show ${layer.name} layer`}
                  aria-pressed={visible}
                >
                  {visible ? (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{visible ? `Hide ${layer.name} layer` : `Show ${layer.name} layer`}</p>
              </TooltipContent>
            </Tooltip>

            {/* Lock Toggle */}
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  className="h-8 w-8"
                  onClick={handleLockToggle}
                  aria-label={locked ? `Unlock ${layer.name} layer` : `Lock ${layer.name} layer`}
                  aria-pressed={locked}
                >
                  {locked ? (
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Unlock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{locked ? `Unlock ${layer.name} layer` : `Lock ${layer.name} layer`}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Opacity Slider */}
        {visible && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <Label htmlFor={opacityId} className="cursor-pointer">
                Opacity
              </Label>
              <span aria-live="polite">{Math.round(opacity * 100)}%</span>
            </div>
            <Slider
              id={opacityId}
              value={[opacity]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={handleOpacityChange}
              onValueCommit={handleOpacityCommit}
              className="w-full"
              disabled={!visible}
              aria-label={`${layer.name} layer opacity`}
              getAriaValueText={(value) => `${Math.round(value * 100)}%`}
            />
          </div>
        )}
      </div>
    );
  },
);

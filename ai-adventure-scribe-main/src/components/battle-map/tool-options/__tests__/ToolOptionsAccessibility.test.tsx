import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { DrawOptions } from '../DrawOptions';
import { AoEOptions } from '../AoEOptions';
import { WallOptions } from '../WallOptions';
import { FogOptions } from '../FogOptions';
import { LayersPanel } from '../../LayersPanel';
import { useBattleMapStore } from '@/stores/useBattleMapStore';

// Mock trpc
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      scenes: {
        getById: {
          invalidate: vi.fn(),
        },
      },
    }),
    scenes: {
      getById: {
        useQuery: () => ({
          data: {
            layers: [
              { id: 'layer-1', layerType: 'background' }
            ],
          },
        }),
      },
      updateLayer: {
        useMutation: () => ({
          mutate: vi.fn(),
        }),
      },
    },
  },
}));

describe('Battle Map Tool Options Accessibility', () => {
  beforeAll(() => {
    // Mock ResizeObserver which is missing in jsdom
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  describe('DrawOptions', () => {
    it('provides descriptive aria-valuetext for sliders', () => {
      render(
        <TooltipProvider>
        <DrawOptions
          strokeWidth={5}
          setStrokeWidth={vi.fn()}
          strokeColor="#000000"
          setStrokeColor={vi.fn()}
          fillEnabled={true}
          setFillEnabled={vi.fn()}
          fillColor="#ffffff"
          setFillColor={vi.fn()}
          fillOpacity={0.5}
          setFillOpacity={vi.fn()}
          strokeWidthId="stroke-width"
          fillOpacityId="fill-opacity"
        />
        </TooltipProvider>
      );

      const strokeSliderRoot = screen.getByLabelText(/stroke width/i);
      const strokeSlider = within(strokeSliderRoot).getByRole('slider');
      expect(strokeSlider).toHaveAttribute('aria-valuetext', '5px');

      const opacitySliderRoot = screen.getByLabelText(/fill opacity/i);
      const opacitySlider = within(opacitySliderRoot).getByRole('slider');
      expect(opacitySlider).toHaveAttribute('aria-valuetext', '50%');
    });
  });

  describe('AoEOptions', () => {
    it('provides descriptive aria-valuetext for opacity slider', () => {
      render(
        <AoEOptions
          templateType="cone"
          setTemplateType={vi.fn()}
          fillColor="#ffffff"
          setFillColor={vi.fn()}
          fillOpacity={0.75}
          setFillOpacity={vi.fn()}
          templateTypeId="template-type"
          aoeOpacityId="aoe-opacity"
        />
      );

      const opacitySliderRoot = screen.getByLabelText(/template opacity/i);
      const opacitySlider = within(opacitySliderRoot).getByRole('slider');
      expect(opacitySlider).toHaveAttribute('aria-valuetext', '75%');
    });
  });

  describe('WallOptions', () => {
    it('provides descriptive aria-valuetext for stroke width slider', () => {
      render(
        <TooltipProvider>
        <WallOptions
          wallType="solid"
          setWallType={vi.fn()}
          snapToGrid={true}
          toggleSnapToGrid={vi.fn()}
          strokeWidth={3}
          setStrokeWidth={vi.fn()}
          wallTypeId="wall-type"
          wallStrokeWidthId="wall-stroke-width"
        />
        </TooltipProvider>
      );

      const strokeSliderRoot = screen.getByLabelText(/wall stroke width/i);
      const strokeSlider = within(strokeSliderRoot).getByRole('slider');
      expect(strokeSlider).toHaveAttribute('aria-valuetext', '3px');
    });
  });

  describe('FogOptions', () => {
    it('provides descriptive aria-valuetext for brush size slider', () => {
      render(
        <FogOptions
          brushMode="reveal"
          setBrushMode={vi.fn()}
          brushSize={50}
          setBrushSize={vi.fn()}
          brushModeId="brush-mode"
          brushSizeId="brush-size"
        />
      );

      const sizeSliderRoot = screen.getByLabelText(/brush size/i);
      const sizeSlider = within(sizeSliderRoot).getByRole('slider');
      expect(sizeSlider).toHaveAttribute('aria-valuetext', '50px');
    });
  });

  describe('LayersPanel', () => {
    it('provides descriptive aria-valuetext for opacity slider', () => {
      // Set store state for the test
      useBattleMapStore.getState().setLayerOpacity('background', 0.8);

      render(
        <LayersPanel
          sceneId="scene-1"
          open={true}
        />
      );

      const opacitySliderRoot = screen.getByLabelText(/background layer opacity/i);
      const opacitySlider = within(opacitySliderRoot).getByRole('slider');
      expect(opacitySlider).toHaveAttribute('aria-valuetext', '80%');
    });
  });
});

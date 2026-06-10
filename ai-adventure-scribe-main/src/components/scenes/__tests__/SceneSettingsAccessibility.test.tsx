import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { SceneSettings } from '../SceneSettings';

describe('SceneSettings Accessibility', () => {
  beforeAll(() => {
    // Mock ResizeObserver which is missing in jsdom
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('renders switches and radio group items with unique IDs and correctly linked labels', () => {
    const onChange = vi.fn();
    const settings = {
      enableFogOfWar: true,
      enableDynamicLighting: false,
      snapToGrid: true,
      timeOfDay: 'day',
    };

    render(
      <SceneSettings
        settings={settings}
        onChange={onChange}
      />
    );

    // Check Fog of War switch
    const fogOfWarLabel = screen.getAllByText(/Fog of War/i).find(el => el.tagName === 'LABEL');
    expect(fogOfWarLabel).toBeDefined();
    const fogOfWarSwitch = screen.getByRole('switch', { name: /Fog of War/i });
    expect(fogOfWarSwitch).toBeInTheDocument();
    expect(fogOfWarSwitch).toHaveAttribute('id');
    expect(fogOfWarLabel).toHaveAttribute('for', fogOfWarSwitch.id);

    // Check Dynamic Lighting switch
    const dynamicLightingLabel = screen.getAllByText(/Dynamic Lighting/i).find(el => el.tagName === 'LABEL');
    expect(dynamicLightingLabel).toBeDefined();
    const dynamicLightingSwitch = screen.getByRole('switch', { name: /Dynamic Lighting/i });
    expect(dynamicLightingSwitch).toBeInTheDocument();
    expect(dynamicLightingSwitch).toHaveAttribute('id');
    expect(dynamicLightingLabel).toHaveAttribute('for', dynamicLightingSwitch.id);

    // Check Snap to Grid switch
    const snapToGridLabel = screen.getAllByText(/Snap to Grid/i).find(el => el.tagName === 'LABEL');
    expect(snapToGridLabel).toBeDefined();
    const snapToGridSwitch = screen.getByRole('switch', { name: /Snap to Grid/i });
    expect(snapToGridSwitch).toBeInTheDocument();
    expect(snapToGridSwitch).toHaveAttribute('id');
    expect(snapToGridLabel).toHaveAttribute('for', snapToGridSwitch.id);

    // Check Time of Day radio group
    const radioGroup = screen.getByRole('radiogroup', { name: /Time of Day/i });
    expect(radioGroup).toBeInTheDocument();

    // Check individual time options
    const dawnOption = screen.getByRole('radio', { name: /Dawn/i });
    const dayOption = screen.getByRole('radio', { name: /Day/i });
    const duskOption = screen.getByRole('radio', { name: /Dusk/i });
    const nightOption = screen.getByRole('radio', { name: /Night/i });

    expect(dawnOption).toBeInTheDocument();
    expect(dayOption).toBeInTheDocument();
    expect(duskOption).toBeInTheDocument();
    expect(nightOption).toBeInTheDocument();

    expect(dawnOption).toHaveAttribute('id');
    expect(dayOption).toHaveAttribute('id');
    expect(duskOption).toHaveAttribute('id');
    expect(nightOption).toHaveAttribute('id');

    // Check Sliders - the role 'slider' is on the Root component which has the aria-label
    // but some implementations might put it elsewhere. Let's find them by aria-label directly.
    const gridOpacitySlider = screen.getByLabelText(/Grid opacity percentage/i);
    expect(gridOpacitySlider).toBeInTheDocument();

    // Radix Slider might put aria-valuetext on the thumb, and the role 'slider' might be there too.
    // Let's check the container or its children.
    const sliders = screen.getAllByRole('slider');

    const gridOpacityThumb = sliders.find(s => s.getAttribute('aria-valuetext') === '30%');
    expect(gridOpacityThumb).toBeDefined();

    const ambientLightThumb = sliders.find(s => s.getAttribute('aria-valuetext') === '100%');
    expect(ambientLightThumb).toBeDefined();

    const darknessThumb = sliders.find(s => s.getAttribute('aria-valuetext') === '0%');
    expect(darknessThumb).toBeDefined();

    // Verify IDs are unique
    const ids = [
      fogOfWarSwitch.id,
      dynamicLightingSwitch.id,
      snapToGridSwitch.id,
      dawnOption.id,
      dayOption.id,
      duskOption.id,
      nightOption.id,
    ];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

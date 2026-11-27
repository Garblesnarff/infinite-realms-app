/**
 * The provider's last-scene-art state (#1026): a monster, NPC, item or
 * character background must not clear the last location-or-scene image, so
 * the band's fallback still shows the session's current place. These run the
 * real provider — the DMMessage test mock re-implements the filter, so it
 * cannot catch a provider regression.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetType } from '@/contexts/SceneBackgroundContext';

import { SceneBackgroundProvider, useSceneBackground } from '@/contexts/SceneBackgroundContext';

let latest: ReturnType<typeof useSceneBackground> | null = null;

function Probe() {
  latest = useSceneBackground();
  return null;
}

function current() {
  if (!latest) throw new Error('probe did not render');
  return latest;
}

function setBackground(url: string | null, name: string | null, type: AssetType | null) {
  act(() => {
    current().setSceneBackground(url, name, type);
  });
  // The provider applies the update after its 300ms fade-out timeout.
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

describe('SceneBackgroundProvider last scene art (#1026)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps the last location image after a monster background takes over', () => {
    render(
      <SceneBackgroundProvider>
        <Probe />
      </SceneBackgroundProvider>,
    );
    setBackground('heartwood.png', 'The Heartwood', 'location');
    expect(current().currentBackgroundUrl).toBe('heartwood.png');
    expect(current().lastSceneArtUrl).toBe('heartwood.png');
    expect(current().lastSceneArtName).toBe('The Heartwood');

    setBackground('goblin.png', 'Goblin', 'monster');
    expect(current().currentBackgroundUrl).toBe('goblin.png');
    expect(current().currentAssetType).toBe('monster');
    expect(current().lastSceneArtUrl).toBe('heartwood.png');
    expect(current().lastSceneArtName).toBe('The Heartwood');
  });

  it('follows a scene image the same way as a location', () => {
    render(
      <SceneBackgroundProvider>
        <Probe />
      </SceneBackgroundProvider>,
    );
    setBackground('heartwood.png', 'The Heartwood', 'location');
    setBackground('basin-vista.png', 'Basin Vista', 'scene');
    expect(current().currentBackgroundUrl).toBe('basin-vista.png');
    expect(current().lastSceneArtUrl).toBe('basin-vista.png');
    expect(current().lastSceneArtName).toBe('Basin Vista');
  });

  it('records a location that reuses an image URL already current under another type', () => {
    render(
      <SceneBackgroundProvider>
        <Probe />
      </SceneBackgroundProvider>,
    );
    setBackground('shared.png', 'Goblin', 'monster');
    expect(current().lastSceneArtUrl).toBeNull();

    setBackground('shared.png', 'The Heartwood', 'location');
    expect(current().currentBackgroundUrl).toBe('shared.png');
    expect(current().lastSceneArtUrl).toBe('shared.png');
    expect(current().lastSceneArtName).toBe('The Heartwood');
  });
});

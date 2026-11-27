/**
 * Scene Background Context
 *
 * Manages the background image displayed behind the game UI.
 * Updates when players enter new locations or encounter entities with visual assets.
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export type AssetType = 'location' | 'monster' | 'npc' | 'item' | 'scene' | 'character';

interface SceneBackgroundContextValue {
  /** Current background image URL */
  currentBackgroundUrl: string | null;
  /** Name of the current asset */
  currentAssetName: string | null;
  /** Type of the current asset */
  currentAssetType: AssetType | null;
  /**
   * The last location-or-scene image the background effect set (#1026):
   * the same two types pickSceneArt treats as band art. A monster, NPC,
   * item or character background must not clear it.
   */
  lastSceneArtUrl: string | null;
  /** Name of the last location-or-scene asset */
  lastSceneArtName: string | null;
  /** Set the scene background */
  setSceneBackground: (url: string | null, name: string | null, type: AssetType | null) => void;
  /** Whether background is transitioning */
  isTransitioning: boolean;
}

const SceneBackgroundContext = createContext<SceneBackgroundContextValue | null>(null);

interface SceneBackgroundProviderProps {
  children: React.ReactNode;
}

/**
 * SceneBackgroundProvider Component
 *
 * Provides scene background state to all child components.
 */
export function SceneBackgroundProvider({ children }: SceneBackgroundProviderProps): JSX.Element {
  const [currentBackgroundUrl, setCurrentBackgroundUrl] = useState<string | null>(null);
  const [currentAssetName, setCurrentAssetName] = useState<string | null>(null);
  const [currentAssetType, setCurrentAssetType] = useState<AssetType | null>(null);
  const [lastSceneArtUrl, setLastSceneArtUrl] = useState<string | null>(null);
  const [lastSceneArtName, setLastSceneArtName] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const setSceneBackground = useCallback(
    (url: string | null, name: string | null, type: AssetType | null) => {
      // A location or scene reusing an image URL already current under another
      // type (e.g. a monster) still counts as the last scene art (#1026):
      // the early return below must not leave a stale place behind.
      if (url === currentBackgroundUrl) {
        if (type === 'location' || type === 'scene') {
          setLastSceneArtUrl(url);
          setLastSceneArtName(name);
        }
        return;
      }

      // Start transition
      setIsTransitioning(true);

      // Small delay for fade out, then update
      setTimeout(() => {
        setCurrentBackgroundUrl(url);
        setCurrentAssetName(name);
        setCurrentAssetType(type);
        // The band's fallback reads the last location-or-scene image (#1026),
        // updated atomically with the current background. A monster, NPC, item
        // or character background leaves it alone, so the next place-less
        // reply still shows the session's current place.
        if (type === 'location' || type === 'scene') {
          setLastSceneArtUrl(url);
          setLastSceneArtName(name);
        }

        // End transition after fade in
        setTimeout(() => {
          setIsTransitioning(false);
        }, 500);
      }, 300);
    },
    [currentBackgroundUrl],
  );

  const value = useMemo(
    () => ({
      currentBackgroundUrl,
      currentAssetName,
      currentAssetType,
      lastSceneArtUrl,
      lastSceneArtName,
      setSceneBackground,
      isTransitioning,
    }),
    [
      currentBackgroundUrl,
      currentAssetName,
      currentAssetType,
      lastSceneArtUrl,
      lastSceneArtName,
      setSceneBackground,
      isTransitioning,
    ],
  );

  return (
    <SceneBackgroundContext.Provider value={value}>{children}</SceneBackgroundContext.Provider>
  );
}

/**
 * Hook to access scene background context
 */
export function useSceneBackground(): SceneBackgroundContextValue {
  const context = useContext(SceneBackgroundContext);

  if (!context) {
    // Return no-op implementation if not in provider
    return {
      currentBackgroundUrl: null,
      currentAssetName: null,
      currentAssetType: null,
      lastSceneArtUrl: null,
      lastSceneArtName: null,
      setSceneBackground: () => {},
      isTransitioning: false,
    };
  }

  return context;
}

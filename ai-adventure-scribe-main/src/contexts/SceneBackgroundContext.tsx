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
  const [isTransitioning, setIsTransitioning] = useState(false);

  const setSceneBackground = useCallback(
    (url: string | null, name: string | null, type: AssetType | null) => {
      // Don't update if same URL
      if (url === currentBackgroundUrl) return;

      // Start transition
      setIsTransitioning(true);

      // Small delay for fade out, then update
      setTimeout(() => {
        setCurrentBackgroundUrl(url);
        setCurrentAssetName(name);
        setCurrentAssetType(type);

        // End transition after fade in
        setTimeout(() => {
          setIsTransitioning(false);
        }, 500);
      }, 300);
    },
    [currentBackgroundUrl]
  );

  const value = useMemo(
    () => ({
      currentBackgroundUrl,
      currentAssetName,
      currentAssetType,
      setSceneBackground,
      isTransitioning,
    }),
    [currentBackgroundUrl, currentAssetName, currentAssetType, setSceneBackground, isTransitioning]
  );

  return (
    <SceneBackgroundContext.Provider value={value}>
      {children}
    </SceneBackgroundContext.Provider>
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
      setSceneBackground: () => {},
      isTransitioning: false,
    };
  }

  return context;
}

/**
 * Campaign Assets Context
 *
 * Provides access to campaign assets (images for characters, NPCs, locations, etc.)
 * throughout the game session. Wraps the useCampaignAssets hook and makes
 * asset lookup available to all child components.
 */

import React, { createContext, useContext, useMemo } from 'react';

import { useCampaignAssets, type CampaignAsset } from '@/hooks/use-campaign-assets';

interface CampaignAssetsContextValue {
  /** Get asset by type and key */
  getAsset: (type: string, key: string) => CampaignAsset | null;
  /** Get image URL for asset */
  getAssetImageUrl: (type: string, key: string) => string | null;
  /** All loaded assets */
  assets: CampaignAsset[];
  /** Asset list formatted for AI prompt injection */
  assetListForPrompt: string;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** The starter campaign ID */
  starterCampaignId: string | null;
}

const CampaignAssetsContext = createContext<CampaignAssetsContextValue | null>(null);

interface CampaignAssetsProviderProps {
  starterCampaignId: string | null | undefined;
  children: React.ReactNode;
}

/**
 * CampaignAssetsProvider Component
 *
 * Wraps children with campaign assets context. Load assets for the
 * specified starter campaign and provide lookup functions.
 */
export function CampaignAssetsProvider({
  starterCampaignId,
  children,
}: CampaignAssetsProviderProps): JSX.Element {
  const { getAsset, getAssetImageUrl, assets, assetListForPrompt, isLoading, error } =
    useCampaignAssets(starterCampaignId);

  const value = useMemo(
    () => ({
      getAsset,
      getAssetImageUrl,
      assets,
      assetListForPrompt,
      isLoading,
      error,
      starterCampaignId: starterCampaignId || null,
    }),
    [getAsset, getAssetImageUrl, assets, assetListForPrompt, isLoading, error, starterCampaignId]
  );

  return (
    <CampaignAssetsContext.Provider value={value}>{children}</CampaignAssetsContext.Provider>
  );
}

/**
 * Hook to access campaign assets context
 */
export function useCampaignAssetsContext(): CampaignAssetsContextValue {
  const context = useContext(CampaignAssetsContext);

  if (!context) {
    // Return a no-op implementation if not in a provider
    // This allows components to work even without campaign assets
    return {
      getAsset: () => null,
      getAssetImageUrl: () => null,
      assets: [],
      assetListForPrompt: '',
      isLoading: false,
      error: null,
      starterCampaignId: null,
    };
  }

  return context;
}

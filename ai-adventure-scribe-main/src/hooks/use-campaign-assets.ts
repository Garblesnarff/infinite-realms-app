/**
 * Hook for loading and accessing campaign assets
 *
 * Loads entity images and metadata from:
 * - starter_character_templates (character portraits)
 * - campaign_chunks (NPC, location, item images from metadata)
 * - starter_campaigns (cover/banner images)
 *
 * Provides a lookup function to get asset URLs by type and key.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export interface CampaignAsset {
  type: 'character' | 'npc' | 'location' | 'monster' | 'item' | 'scene';
  key: string;
  name: string;
  imageUrl: string | null;
  description?: string;
}

interface UseCampaignAssetsResult {
  /** Get asset by type and key */
  getAsset: (type: string, key: string) => CampaignAsset | null;
  /** Get image URL for asset, or null if not found */
  getAssetImageUrl: (type: string, key: string) => string | null;
  /** All loaded assets */
  assets: CampaignAsset[];
  /** Asset list formatted for AI prompt injection */
  assetListForPrompt: string;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Generate a URL-friendly key from a name
 */
function generateKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[""''«»`]/g, '')      // Remove all quote variants (Unicode + ASCII)
    .replace(/[^a-z0-9\s-]/g, '')   // Remove remaining special chars
    .replace(/\s+/g, '-')           // Spaces to hyphens
    .replace(/-+/g, '-')            // Collapse multiple hyphens
    .trim();
}

/**
 * Load campaign assets for a starter campaign
 *
 * @param starterCampaignId - The starter campaign ID (e.g., 'abyssal-descent')
 */
export function useCampaignAssets(
  starterCampaignId: string | null | undefined
): UseCampaignAssetsResult {
  const [assets, setAssets] = useState<CampaignAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    logger.debug('[CampaignAssets] Effect triggered with starterCampaignId:', starterCampaignId);

    if (!starterCampaignId) {
      logger.debug('[CampaignAssets] No campaignId provided, skipping asset load');
      setAssets([]);
      return;
    }

    async function loadAssets(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const loadedAssets: CampaignAsset[] = [];

        // ⚡ Bolt: Parallelize asset loading to reduce total latency.
        // Instead of 3 sequential await calls, Promise.all executes them concurrently.
        const [charResult, chunkResult, campaignResult] = await Promise.all([
          supabase
            .from('starter_character_templates')
            .select('template_key, name, tagline, portrait_url')
            .eq('starter_campaign_id', starterCampaignId),
          supabase
            .from('campaign_chunks')
            .select('entity_name, chunk_type, metadata')
            .eq('campaign_id', starterCampaignId)
            .not('entity_name', 'is', null),
          supabase
            .from('starter_campaigns')
            .select('title, cover_image_url, banner_image_url')
            .eq('id', starterCampaignId)
            .single(),
        ]);

        // 1. Process character templates with portraits
        if (charResult.error) {
          logger.warn('[CampaignAssets] Failed to load characters:', charResult.error);
        } else if (charResult.data) {
          for (const char of charResult.data) {
            if (char.portrait_url) {
              loadedAssets.push({
                type: 'character',
                key: char.template_key || generateKey(char.name),
                name: char.name,
                imageUrl: char.portrait_url,
                description: char.tagline || undefined,
              });
            }
          }
        }

        // 2. Process campaign chunks with images in metadata
        if (chunkResult.error) {
          logger.warn('[CampaignAssets] Failed to load chunks:', chunkResult.error);
        } else if (chunkResult.data) {
          for (const chunk of chunkResult.data) {
            const metadata = chunk.metadata as Record<string, unknown> | null;
            const imageUrl = metadata?.image_url as string | undefined;

            if (imageUrl && chunk.entity_name) {
              // Map chunk_type to asset type
              let assetType: CampaignAsset['type'];
              const chunkType = chunk.chunk_type as string;

              if (chunkType.startsWith('npc')) {
                assetType = 'npc';
              } else if (chunkType === 'location') {
                assetType = 'location';
              } else if (chunkType === 'item') {
                assetType = 'item';
              } else if (chunkType === 'monster' || chunkType === 'encounter') {
                assetType = 'monster';
              } else {
                continue; // Skip unsupported types
              }

              loadedAssets.push({
                type: assetType,
                key: generateKey(chunk.entity_name),
                name: chunk.entity_name,
                imageUrl,
                description: metadata?.description as string | undefined,
              });
            }
          }
        }

        // 3. Process campaign cover/banner as scene assets
        if (campaignResult.error) {
          logger.warn('[CampaignAssets] Failed to load campaign:', campaignResult.error);
        } else if (campaignResult.data) {
          const campaign = campaignResult.data;
          if (campaign.cover_image_url) {
            loadedAssets.push({
              type: 'scene',
              key: 'campaign-cover',
              name: `${campaign.title} - Cover`,
              imageUrl: campaign.cover_image_url,
            });
          }
          if (campaign.banner_image_url) {
            loadedAssets.push({
              type: 'scene',
              key: 'campaign-banner',
              name: `${campaign.title} - Banner`,
              imageUrl: campaign.banner_image_url,
            });
          }
        }

        logger.debug(
          '[CampaignAssets] Loaded',
          loadedAssets.length,
          'assets for campaign:',
          starterCampaignId,
        );
        setAssets(loadedAssets);
      } catch (err) {
        logger.error('[CampaignAssets] Error loading assets:', err);
        setError(err instanceof Error ? err : new Error('Failed to load campaign assets'));
      } finally {
        setIsLoading(false);
      }
    }

    loadAssets();
  }, [starterCampaignId]);

  // Create asset lookup map
  const assetMap = useMemo(() => {
    const map = new Map<string, CampaignAsset>();
    for (const asset of assets) {
      map.set(`${asset.type}:${asset.key}`, asset);
    }
    return map;
  }, [assets]);

  // Get asset by type and key
  const getAsset = useCallback(
    (type: string, key: string): CampaignAsset | null => {
      return assetMap.get(`${type}:${key}`) || null;
    },
    [assetMap],
  );

  // Get just the image URL
  const getAssetImageUrl = useCallback(
    (type: string, key: string): string | null => {
      const asset = getAsset(type, key);
      return asset?.imageUrl || null;
    },
    [getAsset],
  );

  // Generate asset list for AI prompt
  const assetListForPrompt = useMemo(() => {
    if (assets.length === 0) return '';

    const lines = ['## Available Visual Assets'];
    lines.push('When you describe or introduce these entities, include the tag shown:');
    lines.push('');

    // Group by type
    const byType: Record<string, CampaignAsset[]> = {};
    for (const asset of assets) {
      if (!byType[asset.type]) byType[asset.type] = [];
      byType[asset.type].push(asset);
    }

    for (const [type, typeAssets] of Object.entries(byType)) {
      lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
      for (const asset of typeAssets) {
        lines.push(`- ${asset.name} [ASSET:${type}:${asset.key}]`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }, [assets]);

  return {
    getAsset,
    getAssetImageUrl,
    assets,
    assetListForPrompt,
    isLoading,
    error,
  };
}

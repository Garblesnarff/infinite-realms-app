/**
 * Hook for fetching starter campaigns
 *
 * Provides access to published, complete starter campaigns for the launch page
 * and campaign detail views.
 */

import { useEffect, useState, useMemo } from 'react';

import { supabase } from '@/integrations/supabase/client';

export interface StarterCampaign {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  genre: string[];
  tone: string[];
  difficulty: string;
  levelRange: string | null;
  estimatedSessions: string | null;
  premise: string;
  creativeBrief: string | null;
  overview: string | null;
  isComplete: boolean;
  isPublished: boolean;
  isFeatured: boolean;
  coverImageUrl: string | null;
  bannerImageUrl: string | null;
}

interface UseStarterCampaignsResult {
  campaigns: StarterCampaign[];
  featuredCampaigns: StarterCampaign[];
  isLoading: boolean;
  error: Error | null;
}

interface UseStarterCampaignResult {
  campaign: StarterCampaign | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Map database row to StarterCampaign interface
 */
function mapCampaignRow(row: Record<string, unknown>): StarterCampaign {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    tagline: row.tagline as string | null,
    genre: (row.genre as string[]) || [],
    tone: (row.tone as string[]) || [],
    difficulty: row.difficulty as string,
    levelRange: row.level_range as string | null,
    estimatedSessions: row.estimated_sessions as string | null,
    premise: row.premise as string,
    creativeBrief: row.creative_brief as string | null,
    overview: row.overview as string | null,
    isComplete: row.is_complete as boolean,
    isPublished: row.is_published as boolean,
    isFeatured: row.is_featured as boolean,
    coverImageUrl: row.cover_image_url as string | null,
    bannerImageUrl: row.banner_image_url as string | null,
  };
}

/**
 * Fetch all published starter campaigns
 */
export function useStarterCampaigns(): UseStarterCampaignsResult {
  const [campaigns, setCampaigns] = useState<StarterCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchCampaigns(): Promise<void> {
      try {
        const { data, error: queryError } = await supabase
          .from('starter_campaigns')
          .select(
            'id, slug, title, tagline, genre, tone, difficulty, level_range, estimated_sessions, premise, is_complete, is_published, is_featured, cover_image_url, banner_image_url',
          )
          .eq('is_published', true)
          .eq('is_complete', true)
          .order('title');

        if (queryError) {
          throw new Error(queryError.message);
        }

        const mapped = (data || []).map(mapCampaignRow);
        setCampaigns(mapped);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch campaigns'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchCampaigns();
  }, []);

  const featuredCampaigns = useMemo(() => campaigns.filter((c) => c.isFeatured), [campaigns]);

  return useMemo(
    () => ({ campaigns, featuredCampaigns, isLoading, error }),
    [campaigns, featuredCampaigns, isLoading, error],
  );
}

/**
 * Fetch a single starter campaign by slug
 */
export function useStarterCampaign(slug: string | undefined): UseStarterCampaignResult {
  const [campaign, setCampaign] = useState<StarterCampaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!slug) {
      setIsLoading(false);
      return;
    }

    async function fetchCampaign(): Promise<void> {
      try {
        const { data, error: queryError } = await supabase
          .from('starter_campaigns')
          .select(
            'id, slug, title, tagline, genre, tone, difficulty, level_range, estimated_sessions, premise, creative_brief, overview, is_complete, is_published, is_featured, cover_image_url, banner_image_url',
          )
          .eq('slug', slug)
          .eq('is_published', true)
          .eq('is_complete', true)
          .single();

        if (queryError) {
          if (queryError.code === 'PGRST116') {
            // Not found
            setCampaign(null);
          } else {
            throw new Error(queryError.message);
          }
        } else {
          setCampaign(mapCampaignRow(data));
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch campaign'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchCampaign();
  }, [slug]);

  return useMemo(() => ({ campaign, isLoading, error }), [campaign, isLoading, error]);
}
